/* eslint-disable no-console */
import * as dotenv from 'dotenv' // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
dotenv.config();

import * as path from 'node:path';
import * as url from 'node:url';

import { dirname } from 'desm';
import express from 'express'; // eslint-disable-line import/no-unresolved
import helmet from 'helmet';

import Provider from 'oidc-provider';

import Account from './support/account.js';
import configuration from './support/configuration.js';
import routes from './routes/express.js';


const __dirname = dirname(import.meta.url);

const { PORT = 3000, ISSUER = `http://localhost:${PORT}` } = process.env;
configuration.findAccount = Account.findAccount;

process.on('uncaughtException', (error) => {
  console.log('Oh my god, something terrible happened: ', error);
});

process.on('unhandledRejection', (error, promise) => {
  console.log(' Oh Lord! We forgot to handle a promise rejection here: ', promise);
  console.log(' The error was: ', error);
});

if(process.env.ISSUER.indexOf("localhost") < 0) {
  configuration.clients[0].redirect_uris.push(`${process.env.ISSUER}/sendToAd`);
  configuration.clients[0].redirect_uris.push(`${process.env.ADB2C_RETURN_URL}`);
  // configuration.cookies.long = {
  //   secure: true
  // },
  // configuration.cookies.short = {
  //   secure: true
  // }  
}
console.log(configuration.redirect_uris);

const app = express();

const directives = helmet.contentSecurityPolicy.getDefaultDirectives();
delete directives['form-action'];
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives,
  },
}));

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

let server;
try {
  let adapter;
  if (process.env.MONGODB_URI) {
    ({ default: adapter } = await import('./adapters/mongodb.js'));
    await adapter.connect();
  }

  const prod = process.env.NODE_ENV === 'production';

  const provider = new Provider(ISSUER, { adapter, ...configuration });

  if (prod) {
    app.enable('trust proxy');
    provider.proxy = true;

    app.use((req, res, next) => {
      if (req.secure) {
        next();
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        res.redirect(url.format({
          protocol: 'https',
          host: req.get('host'),
          pathname: req.originalUrl,
        }));
      } else {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'do yourself a favor and only use https',
        });
      }
    });
  }

  app.use('/public', express.static('public'));

  routes(app, provider);
  app.use(provider.callback());



  server = app.listen(PORT, () => {
    console.log(`application is listening on port ${PORT}, check its /.well-known/openid-configuration`);
  });


} catch (err) {
  if (server?.listening) server.close();
  console.error(err);
  process.exitCode = 1;
}
