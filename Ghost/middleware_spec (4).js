var should = require('should'),
    sinon = require('sinon'),

    // Thing we are testing
    redirectAdminUrls = require('../../../../server/web/admin/middleware')[0];

describe('Admin App', function () {
    afterEach(function () {
        sinon.restore();
    });

    describe('middleware', function () {
        describe('redirectAdminUrls', function () {
            var req, res, next;
            // Input: req.originalUrl
            // Output: either next or res.redirect are called
            beforeEach(function () {
                req = {};
                res = {};
                next = sinon.stub();
                res.redirect = sinon.stub();
            });

            it('should redirect a url which starts with ghost', function () {
                req.originalUrl = '/ghost/x';

                redirectAdminUrls(req, res, next);

                next.called.should.be.false();
                res.redirect.called.should.be.true();
                res.redirect.calledWith('/ghost/#/x').should.be.true();
            });

            it('should not redirect /ghost/ on its owh', function () {
                req.originalUrl = '/ghost/';

                redirectAdminUrls(req, res, next);

                next.called.should.be.true();
                res.redirect.called.should.be.false();
            });

            it('should not redirect url that has no slash', function () {
                req.originalUrl = 'ghost/x';

                redirectAdminUrls(req, res, next);

                next.called.should.be.true();
                res.redirect.called.should.be.false();
            });

            it('should not redirect url that starts with something other than /ghost/', function () {
                req.originalUrl = 'x/ghost/x';

                redirectAdminUrls(req, res, next);

                next.called.should.be.true();
                res.redirect.called.should.be.false();
            });
        });
    });
});
