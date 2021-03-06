const AMAuth = require('./am-auth');
const AMError = require('./am-error');
const AMMailing = require('./am-mailing');
const AMInvite = require('./am-invite');
const Message = require('./message');
const Notification = require('./notification');

// Mass requires
const cors = require('cors');
const morgan = require('morgan');
const restful = require('node-restful');
const mongoose = restful.mongoose;
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const Rollbar = require('rollbar');
const Sequelize = require('sequelize');

function setup(app, envs, packag, passport) {
    // Validate params
    if (!app)
        return logThrowError('You must pass app as first parameter to amBootstrap');
    if (!envs)
        return logThrowError('You must pass envs as second parameter to amBootstrap');
    if (!packag)
        return logThrowError('You must pass package as third parameter to amBootstrap');
    if (envs.production && envs.production.database) {
        if (envs.production.database.driver === 'mongoose' && envs.production.database.url)
            return logThrowError('Database URL are not allowed in prod config anymore. Use heroku env DATABASE_URL to store it.');
        if (envs.production.database.driver === 'sequelize' && (envs.production.database.host || envs.production.database.port || envs.production.database.database || envs.production.database.user || envs.production.database.password))
            return logThrowError('Database (host,port,database,user and password) are not allowed in prod/staging config anymore. Use heroku envs to store it.');
    }
    if (envs.staging && envs.staging.database) { // same code from previous block
        if (envs.staging.database.driver === 'mongoose' && envs.staging.database.url)
            return logThrowError('Database URL are not allowed in prod config anymore. Use heroku env DATABASE_URL to store it.');
        if (envs.staging.database.driver === 'sequelize' && (envs.staging.database.host || envs.staging.database.port || envs.staging.database.database || envs.staging.database.user || envs.staging.database.password))
            return logThrowError('Database (host,port,database,user and password) are not allowed in prod/staging config anymore. Use heroku envs to store it.');
    }
    if (!envs.development)
        return logThrowError('You should pass the complete \'envs\' objects as second parameter to amBootstrap, not more \'config\'. Bootstrap will load the right env config.');

    // 1 = Envs and config
    let nodeEnv = process.env.NODE_ENV;
    if (nodeEnv === undefined) {
        if (process.env.NODE && ~process.env.NODE.indexOf('heroku')) {
            return logThrowError('API cannot run on heroku without NODE_ENV defined. You must set it!');
        } else {
            console.warn('Running local. Forcing \'development\' environment on NODE_ENV');
            nodeEnv = 'development';
            process.env.NODE_ENV = 'development';
        }
    }


    // Load config by env
    if (!envs[nodeEnv] || envs[nodeEnv].length === 0) {
        return logThrowError('Missing config for \'' + nodeEnv + '\' env in config.js');
    }
    const config = envs[nodeEnv];
    global.config = config;

    // Validate database driver
    if (!config.database.driver)
        return logThrowError('config.database.driver not set on current env "' + nodeEnv + '"');
    if (config.database.driver !== 'mongoose' && config.database.driver !== 'sequelize')
        return logThrowError('config.database.driver not recognized on env "' + nodeEnv + '". It must be "mongoose" or "sequelize".');

    if (config.database.driver === 'mongoose') {
        if (!config.database.url)
            return logThrowError('config.database.url not set on current env "' + nodeEnv + '"');

        // Get heroku env database url
        if (nodeEnv === 'production' || nodeEnv === 'staging') {
            console.log(nodeEnv, 'process.env', process.env.DATABASE_URL);
            if (!process.env.DATABASE_URL)
                return logThrowError('Enviroment variable DATABASE_URL are not set');
            config.database.url = process.env.DATABASE_URL;
        }
    } else if (config.database.driver === 'sequelize') {
        if (!config.database.host || !config.database.database || !config.database.user || !config.database.password)
            return logThrowError('config.database missing params (for sequelize) on env "' + nodeEnv + '"');

        // Get heroku env database params
        if (nodeEnv === 'production' || nodeEnv === 'staging') {
            if (!process.env.DATABASE_HOST)
                return logThrowError('Enviroment variable DATABASE_HOST are not set');
            if (!process.env.DATABASE_DATABASE)
                return logThrowError('Enviroment variable DATABASE_DATABASE are not set');
            if (!process.env.DATABASE_USER)
                return logThrowError('Enviroment variable DATABASE_USER are not set');
            if (!process.env.DATABASE_PORT)
                return logThrowError('Enviroment variable DATABASE_PORT are not set');
            if (!process.env.DATABASE_PASSWORD)
                return logThrowError('Enviroment variable DATABASE_PASSWORD are not set');
            config.database.host = process.env.DATABASE_HOST;
            config.database.database = process.env.DATABASE_DATABASE;
            config.database.user = process.env.DATABASE_USER;
            config.database.port = process.env.DATABASE_PORT;
            config.database.password = process.env.DATABASE_PASSWORD;
        }
    }


    AMError.init(app);

    // Auth
    // !!!!!!!!!!!!!!!!!!! TO DO !!!!!!!!!!!!!!!!!!!!!!!!!!!!! TO DO !!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    // AMAuth.setup(passport);

    // Cors
    const corsOptions = {
        'origin': '*',
        'methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
        'preflightContinue': false,
        'optionsSuccessStatus': 204,
        exposedHeaders: 'api-version, api-env, min-web-version, min-mobile-version, min-admin-version, user',
        allowedHeaders: 'content-type, Authorization, authorization, client, client-env, admin-version, mobile-version, web-version'
    };
    app.use(cors(corsOptions));

    // Inform API version on every result
    let apiVersion = packag.version;
    // console.log('API Version: ' + apiVersion);
    let minWebVersion = packag.minWebVersion;
    let minMobileVersion = packag.minMobileVersion;
    let minAdminVersion = packag.minAdminVersion;
    // if (!minWebVersion) { console.warn("!! You must set minWebVersion in package.json"); }
    // if (!minMobileVersion) { console.warn("!! You must set minMobileVersion in package.json"); }
    // if (!minAdminVersion) { console.warn("!! You must set minAdminVersion in package.json"); }
    app.use((req, res, next) => {
        // console.log('Version', packag.version);
        res.setHeader('api-version', apiVersion);
        res.setHeader('api-env', nodeEnv);
        if (minWebVersion) {
            res.setHeader('min-web-version', minWebVersion);
        }
        if (minMobileVersion) {
            res.setHeader('min-mobile-version', minMobileVersion);
        }
        if (minAdminVersion) {
            res.setHeader('min-admin-version', minAdminVersion);
        }
        next();
    });

    // Force "client" header to exists on every request received
    if (config.security.checkClientOnDev) {
        app.use((req, res, next) => {
            if (!req.headers.client) {
                throw new Error('Are you my client?');
            } else if (['admin', 'web', 'mobile', 'client'].indexOf(req.headers.client) < 0) {
                throw new Error('Are you really my client?');
            } else {
                next();
            }
        });
    }

    // Start RdStation
    if (config.rdStation && (nodeEnv !== 'development' || config.rdStation.sendOnDev)) {
        let LeadManager = require('@app-masters/node-lib').amLeadManager;
        LeadManager.setRdToken(config.rdStation.privateToken, config.rdStation.token);
    }

    // !!!!!!!!!!!!!!!!!!! TO DO !!!!!!!!!!!!!!!!!!!!!!!!!!!!! TO DO !!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    // Mail and SMS config
    // AMMailing.setup(config);

    // !!!!!!!!!!!!!!!!!!! TO DO !!!!!!!!!!!!!!!!!!!!!!!!!!!!! TO DO !!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    // Invite config
    if (config.invite) {
        // AMInvite.setup(config.invite);
    }

    // !!!!!!!!!!!!!!!!!!! TO DO !!!!!!!!!!!!!!!!!!!!!!!!!!!!! TO DO !!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    // Message config
    if (config.message) {
        // Message.setup(config.message);
    }

    // !!!!!!!!!!!!!!!!!!! TO DO !!!!!!!!!!!!!!!!!!!!!!!!!!!!! TO DO !!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    if (config.notification) {
        // Notification.setup(config.notification);
    }

    // Mass uses
    app.use(bodyParser({limit: '50mb'}));
    app.use(bodyParser.urlencoded({'extended': 'true'}));
    app.use(cookieParser());
    app.use(bodyParser.json());
    app.use(methodOverride());
    app.use(passport.initialize());

    // Morgan - log
    let morganTest = morgan(function (tokens, req, res) {
        return [
            tokens.method(req, res),
            tokens.url(req, res),
            tokens.status(req, res),
            tokens.res(req, res, 'content-length'), '-',
            tokens['response-time'](req, res), 'ms'
        ].join(' ');
    });
    app.use(morganTest, function (req, res, next) {
        if (req.method === 'POST') {
            console.log('POST body', req.body);
        } else if (req.method === 'PUT') {
            console.log('PUT body', req.body);
        }
        next();
    });

    databaseSetup();

    return true;
}

function databaseSetup() {
    // Database
    if (config.database.driver === 'mongoose') {
        // Start connection
        mongoose.Promise = global.Promise;
        let mongoDbUri = global.config.database.url;

        let options = {
            useMongoClient: true,
            keepAlive: 1, connectTimeoutMS: 30000,
            reconnectTries: Number.MAX_VALUE,
            reconnectInterval: 1000
        };

        mongoose.connect(mongoDbUri, options).catch((err) => {
            console.error('Mongoose error:');
            console.error(err);
            Rollbar.error(err);
            Rollbar.log(err);
            //{ MongoError: failed to connect to server [ds143362.mlab.com:43362] on first connect [MongoError: connect ETIMEDOUT 54.196.80.31:43362]
        });
        let db = mongoose.connection;

        // mongodb error
        db.on('error', (err) => {
            console.error('Connection error:');
            console.error(err);
            Rollbar.error(err);
            Rollbar.log(err);
            // Reconnect?
        });

        // Connection open
        db.once('open', () => {
            console.log(`Connected to Mongo at: ${new Date()}`);
        });

        // Disconnected
        db.on('disconnected', function () {
            console.error(`Mongoose default connection disconnected at: ${new Date()}`);
            // Reconnect?
        });
    } else if (config.database.driver === 'sequelize') {
        delete config.database.driver;
        delete config.database.user;
        delete config.database.password;
        delete config.database.database;
        // console.log("config.database", config.database);
        // const sequelize = new Sequelize('sas', 'asas', 'aaa', config.database);
        global.sequelize = new Sequelize(config.database.database, config.database.user, config.database.password, config.database);

        // sequelize.sync().then(function (data) {
        //     console.log(data);
        // }, (e) => {
        //     console.error(e);
        // });
        //
        // sequelize.authenticate().then(function (errors) {
        //     console.error(errors)
        // }).catch(e => {
        //     console.error(e);
        // });
    }
}

function listen(app) {

    const config = global.config;
    AMError.listen(app);

    // 404
    app.use(function (req, res, next) {
        res.status(404).send('Just a 404');
    });

    // Start the server
    const port = process.env.PORT || global.config.port || 3000;
    console.log('Starting at NODE_ENV: ' + process.env.NODE_ENV);



    app.listen(port, function () {
        console.log('listening on port: ' + port);
    });

    return true;
}

function logThrowError(message) {
    console.error(message);
    throw new Error(message);
}

module.exports = {
    setup,
    listen
};
