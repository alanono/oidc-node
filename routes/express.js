/* eslint-disable no-console, camelcase, no-unused-vars */
import { strict as assert } from 'node:assert';
import * as querystring from 'node:querystring';
import { inspect } from 'node:util';

import isEmpty from 'lodash/isEmpty.js';
import { urlencoded } from 'express'; // eslint-disable-line import/no-unresolved

import Account from '../support/account.js';
import fetch from 'node-fetch';

import {parseCookies, isAdmin} from '../support/utils.js';

const body = urlencoded({ extended: false });

const keys = new Set();
const debug = (obj) => querystring.stringify(Object.entries(obj).reduce((acc, [key, value]) => {
  keys.add(key);
  if (isEmpty(value)) return acc;
  acc[key] = inspect(value, { depth: null });
  return acc;
}, {}), '<br/>', ': ', {
  encodeURIComponent(value) { return keys.has(value) ? `<strong>${value}</strong>` : value; },
});

export default (app, provider) => {
  const { constructor: { errors: { SessionNotFound } } } = provider;

  app.use((req, res, next) => {
    const orig = res.render;
    // you'll probably want to use a full blown render engine capable of layouts
    res.render = (view, locals) => {
      app.render(view, locals, (err, html) => {
        if (err) throw err;
        orig.call(res, '_layout', {
          ...locals,
          body: html,
        });
      });
    };
    next();
  });

  function setNoCache(req, res, next) {
    res.set('cache-control', 'no-store');
    next();
  }

  app.get('/interaction/:uid', setNoCache, async (req, res, next) => {
    try {
      const {
        uid, prompt, params, session,
      } = await provider.interactionDetails(req, res);

      const client = await provider.Client.find(params.client_id);
      const cookies = parseCookies(req.headers.cookie);

      switch (prompt.name) {
        case 'login': {
          return res.render('login', {
            client,
            uid,
            details: prompt.details,
            params,
            title: 'Sign-in',
            session: session ? debug(session) : undefined,
            username: cookies["username"],
            dbg: {
              params: debug(params),
              prompt: debug(prompt),
            },
          });
        }
        case 'consent': {
          return res.render('interaction', {
            client,
            uid,
            details: prompt.details,
            params,
            title: 'Authorize',
            session: session ? debug(session) : undefined,
            dbg: {
              params: debug(params),
              prompt: debug(prompt),
            },
          });
        }
        default:
          return undefined;
      }
    } catch (err) {
      return next(err);
    }
  });

  app.post('/interaction/:uid/login', setNoCache, body, async (req, res, next) => {
    try {
      const { prompt: { name } } = await provider.interactionDetails(req, res);
      assert.equal(name, 'login');
      const account = await Account.findByLogin(req.body.login);

      const result = {
        login: {
          accountId: account.accountId,
        },
      };

      await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
    } catch (err) {
      next(err);
    }
  });

  app.post('/interaction/:uid/confirm', setNoCache, body, async (req, res, next) => {
    try {
      const interactionDetails = await provider.interactionDetails(req, res);
      const { prompt: { name, details }, params, session: { accountId } } = interactionDetails;
      assert.equal(name, 'consent');

      let { grantId } = interactionDetails;
      let grant;

      if (grantId) {
        // we'll be modifying existing grant in existing session
        grant = await provider.Grant.find(grantId);
      } else {
        // we're establishing a new grant
        grant = new provider.Grant({
          accountId,
          clientId: params.client_id,
        });
      }

      if (details.missingOIDCScope) {
        grant.addOIDCScope(details.missingOIDCScope.join(' '));
      }
      if (details.missingOIDCClaims) {
        grant.addOIDCClaims(details.missingOIDCClaims);
      }
      if (details.missingResourceScopes) {
        for (const [indicator, scopes] of Object.entries(details.missingResourceScopes)) {
          grant.addResourceScope(indicator, scopes.join(' '));
        }
      }

      grantId = await grant.save();

      const consent = {};
      if (!interactionDetails.grantId) {
        // we don't have to pass grantId to consent, we're just modifying existing one
        consent.grantId = grantId;
      }

      const result = { consent };
      await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/interaction/:uid/abort', setNoCache, async (req, res, next) => {
    try {
      const result = {
        error: 'access_denied',
        error_description: 'End-User aborted interaction',
      };
      await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
    } catch (err) {
      next(err);
    }
  });

  app.get('/start', setNoCache, async (req, res, next) => {
    try {
      // expira todos os cookies atuais
      var cookie = parseCookies(req.headers.cookie);
      if (cookie) {
        for (var prop in cookie) {
          res.clearCookie(prop)
        }
      }

      const session_bo = req.query.session_bo;
      const username = req.query.username;

      if(!isAdmin(session_bo)) {
        return res.status(403);
      }
      
      res.cookie('session_bo', session_bo, { maxAge: 120000, httpOnly: true });
      res.cookie('username', username, { maxAge: 120000, httpOnly: true });

      let endurl = encodeURIComponent(`${process.env.ISSUER}/sendToAd`);
      if(req.query.debug) {
        endurl = encodeURIComponent(`https://jwt.ms`);
      }

      res.redirect(`/auth?client_id=827231e9-9e10-4cd9-9b70-0886687023de&response_type=id_token&redirect_uri=${endurl}&state=${username}&scope=openid+email+profile&nonce=12`);
    } catch (err) {
      next(err);
    }
  });

  app.get('/sendToAd', setNoCache, async (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    res.redirect(`${process.env.ADB2C_AUTH_URL}&login_hint=${cookies["username"]}`);
  });

  app.use((err, req, res, next) => {
    if (err instanceof SessionNotFound) {
      // handle interaction expired / session not found error
    }
    next(err);
  });

};
