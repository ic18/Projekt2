// This file contains methods responsible for maintaining a TraversalContext.

import traverse from "../index";

export function call(key): boolean {
  const opts = this.opts;

  this.debug(key);

  if (this.node) {
    if (this._call(opts[key])) return true;
  }

  if (this.node) {
    return this._call(opts[this.node.type] && opts[this.node.type][key]);
  }

  return false;
}

export function _call(fns?: Array<Function>): boolean {
  if (!fns) return false;

  for (const fn of fns) {
    if (!fn) continue;

    const node = this.node;
    if (!node) return true;

    const ret = fn.call(this.state, this, this.state);
    if (ret && typeof ret === "object" && typeof ret.then === "function") {
      throw new Error(
        `You appear to be using a plugin with an async traversal visitor, ` +
          `which your current version of Babel does not support. ` +
          `If you're using a published plugin, you may need to upgrade ` +
          `your @babel/core version.`,
      );
    }
    if (ret) {
      throw new Error(`Unexpected return value from visitor method ${fn}`);
    }

    // node has been replaced, it will have been requeued
    if (this.node !== node) return true;

    if (this.shouldStop || this.shouldSkip || this.removed) return true;
  }

  return false;
}

export function isBlacklisted(): boolean {
  const blacklist = this.opts.blacklist;
  return blacklist && blacklist.indexOf(this.node.type) > -1;
}

export function visit(): boolean {
  if (!this.node) {
    return false;
  }

  if (this.isBlacklisted()) {
    return false;
  }

  if (this.opts.shouldSkip && this.opts.shouldSkip(this)) {
    return false;
  }

  // Note: We need to check "this.shouldSkip" twice because
  // the visitor can set it to true. Usually .shouldSkip is false
  // before calling the enter visitor, but it can be true in case of
  // a requeued node (e.g. by .replaceWith()) that is then marked
  // with .skip().
  if (this.shouldSkip || this.call("enter") || this.shouldSkip) {
    this.debug("Skip...");
    return this.shouldStop;
  }

  this.debug("Recursing into...");
  traverse.node(
    this.node,
    this.opts,
    this.scope,
    this.state,
    this,
    this.skipKeys,
  );

  this.call("exit");

  return this.shouldStop;
}

export function skip() {
  this.shouldSkip = true;
}

export function skipKey(key) {
  this.skipKeys[key] = true;
}

export function stop() {
  this.shouldStop = true;
  this.shouldSkip = true;
}

export function setScope() {
  if (this.opts && this.opts.noScope) return;

  let path = this.parentPath;
  let target;
  while (path && !target) {
    if (path.opts && path.opts.noScope) return;

    target = path.scope;
    path = path.parentPath;
  }

  this.scope = this.getScope(target);
  if (this.scope) this.scope.init();
}

export function setContext(context) {
  this.shouldSkip = false;
  this.shouldStop = false;
  this.removed = false;
  this.skipKeys = {};

  if (context) {
    this.context = context;
    this.state = context.state;
    this.opts = context.opts;
  }

  this.setScope();

  return this;
}

/**
 * Here we resync the node paths `key` and `container`. If they've changed according
 * to what we have stored internally then we attempt to resync by crawling and looking
 * for the new values.
 */

export function resync() {
  if (this.removed) return;

  this._resyncParent();
  this._resyncList();
  this._resyncKey();
  //this._resyncRemoved();
}

export function _resyncParent() {
  if (this.parentPath) {
    this.parent = this.parentPath.node;
  }
}

export function _resyncKey() {
  if (!this.container) return;

  if (this.node === this.container[this.key]) return;

  // grrr, path key is out of sync. this is likely due to a modification to the AST
  // not done through our path APIs

  if (Array.isArray(this.container)) {
    for (let i = 0; i < this.container.length; i++) {
      if (this.container[i] === this.node) {
        return this.setKey(i);
      }
    }
  } else {
    for (const key of Object.keys(this.container)) {
      if (this.container[key] === this.node) {
        return this.setKey(key);
      }
    }
  }

  // ¯\_(ツ)_/¯ who knows where it's gone lol
  this.key = null;
}

export function _resyncList() {
  if (!this.parent || !this.inList) return;

  const newContainer = this.parent[this.listKey];
  if (this.container === newContainer) return;

  // container is out of sync. this is likely the result of it being reassigned
  this.container = newContainer || null;
}

export function _resyncRemoved() {
  if (
    this.key == null ||
    !this.container ||
    this.container[this.key] !== this.node
  ) {
    this._markRemoved();
  }
}

export function popContext() {
  this.contexts.pop();
  if (this.contexts.length > 0) {
    this.setContext(this.contexts[this.contexts.length - 1]);
  } else {
    this.setContext(undefined);
  }
}

export function pushContext(context) {
  this.contexts.push(context);
  this.setContext(context);
}

export function setup(parentPath, container, listKey, key) {
  this.inList = !!listKey;
  this.listKey = listKey;
  this.parentKey = listKey || key;
  this.container = container;

  this.parentPath = parentPath || this.parentPath;
  this.setKey(key);
}

export function setKey(key) {
  this.key = key;
  this.node = this.container[this.key];
  this.type = this.node && this.node.type;
}

export function requeue(pathToQueue = this) {
  if (pathToQueue.removed) return;

  // TODO: Uncomment in Babel 8. If a path is skipped, and then replaced with a
  // new one, the new one shouldn't probably be skipped.
  // Note that this currently causes an infinite loop because of
  // packages/babel-plugin-transform-block-scoping/src/tdz.js#L52-L59
  // (b5b8055cc00756f94bf71deb45f288738520ee3c)
  //
  // pathToQueue.shouldSkip = false;

  // TODO(loganfsmyth): This should be switched back to queue in parent contexts
  // automatically once #2892 and #4135 have been resolved. See #4140.
  // let contexts = this._getQueueContexts();
  const contexts = this.contexts;

  for (const context of contexts) {
    context.maybeQueue(pathToQueue);
  }
}

export function _getQueueContexts() {
  let path = this;
  let contexts = this.contexts;
  while (!contexts.length) {
    path = path.parentPath;
    if (!path) break;
    contexts = path.contexts;
  }
  return contexts;
}
