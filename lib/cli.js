'use strict';

const Path = require('path');
const Fs = require('fs').promises;
const Util = require('util');

const Bossy = require('@hapi/bossy');
const Dotenv = require('dotenv');
const Mkdirp = require('mkdirp');

const Helpers = require('./helpers');
const DisplayError = require('./display-error');

const Package = require('../package.json');

const {
    COMMANDS_SPACING,
    INDENT_SPACING,
    LOCAL_REMOTES_PATH
} = require('./constants');

// Pull .env into process.env
Dotenv.config({ path: `${__dirname}/../.env` });

const internals = {};

exports.start = async (options) => {

    const args = Bossy.parse(internals.definition, {
        argv: options.argv
    });

    const log = (...logs) => {

        logs.forEach((logItem) => {

            if (String(logItem) === '[object Object]') {

                logItem = Object.entries(logItem).reduce((collector, [key, val]) => {

                    if (val instanceof Error) {
                        collector[key] = val.message;
                    }
                    else {
                        collector[key] = val;
                    }

                    return collector;
                }, {});

                logItem = JSON.stringify(logItem, null, 4);
            }
            else if (Array.isArray(logItem)) {
                logItem = JSON.stringify(logItem, null, 4);
            }

            options.out.write(`${logItem}\n`);
        });
    };

    const ctx = { options, DisplayError };

    // Give some room for output
    log('');

    const command = (args instanceof Error) ? options.argv[2] : args._[2];
    const extraArgs = args._ || [];

    const { displayArgs } = internals;

    const {
        h: help,
        v: version
    } = args;

    let {
        p: path
    } = args;

    // Get absolute path
    if (path) {
        path = Path.isAbsolute(path) ? path : Path.resolve(process.cwd(), path);
    }

    if (version) {
        log(`scopey version: ${Package.version}`);
        log(''); // Spacing
        return;
    }

    if (help) {
        log(`help\n`);
        log(`${internals.usage(ctx)}`);
        log(''); // Spacing
        return;
    }

    const [,,,subCommand] = extraArgs;

    switch (command) {
        case 'help':
            log(`help\n`);
            log(`${internals.usage(ctx)}`);
            break;
        case 'remote': {

            user = await Helpers.pickUser(user, 'sec', 'Pick acting user');

            const USER_LOCAL_TAG_FILE_PATH = LOCAL_TAG_FILE_PATH(user.fingerprint);

            await internals.ensureLocalTag(user);
            await internals.ensureLocalRemotes(user);

            Helpers.assert(subCommand, new DisplayError(displayArgs(command)));

            switch (subCommand) {

                case 'list':

                    log('');
                    await Helpers.withErrHandling(RemoteManager.listRemotes, user);
                    break;

                case 'add':

                    // Part of getting you a remote is logging you in,
                    // storing a valid jwt

                    const remoteUrl = await Helpers.prompt('Enter remote url');

                    const addRemotes = await Helpers.withErrHandling(RemoteManager.listRemotes, user);

                    if (addRemotes.includes(remoteUrl)) {
                        throw new Error(`Remote "${remoteUrl}" already exists!`);
                    }

                    await Helpers.withErrHandling(RemoteManager.addRemote, remoteUrl, user, password);

                    log(`Successfully added remote "${remoteUrl}" and have valid jwt`);
                    break;

                case 'sync': {

                    const remotes = await Helpers.withErrHandling(RemoteManager.listRemotes, user.fingerprint);

                    let remoteToSync;

                    if (remotes.length === 0) {

                        if (!await Helpers.prompt('You have no remotes. Create one now?', 'confirm')) {
                            log('Must have a remote configured to continue');
                            return;
                        }

                        remoteToSync = await Helpers.prompt('Enter remote url');
                    }
                    else if (remotes.length === 1){

                        if (!await Helpers.prompt(`Only one remote exists. Sync remote "${remotes[0]}"?`, 'confirm')) {
                            log('Must select a remote to continue');
                            return;
                        }

                        remoteToSync = remotes[0];
                    }
                    else {
                        remoteToSync = await Helpers.prompt('Please select a remote', 'select', remotes);
                    }

                    const userPubKey = await internals.getUserKey('pub', user);

                    const syncJwt = await Helpers.withErrHandling(RemoteManager.syncRemote, remoteToSync, { ...user, pubKey: userPubKey }, password);
                    let secrets = await Helpers.withErrHandling(RemoteManager.listSecrets, syncJwt, remoteToSync);

                    secrets = (secrets || []).map(({ name }) => name);

                    // Currently we only support syncing your 'DEFAULT_DOG_TAG_NAME'
                    // We need some structure around the local secrets in order to properly
                    // sync with a server. We need to give names to secrets that point to
                    // their local paths

                    if (secrets.includes(DEFAULT_DOG_TAG_NAME)) {

                        const remoteSecret = await Helpers.withErrHandling(RemoteManager.fetchSecret, syncJwt, remoteToSync, DEFAULT_DOG_TAG_NAME);

                        log('');
                        log('Fetched remote dogtag!');

                        const decryptedRemoteTag = await Helpers.withErrHandling(Doggo.api.decrypt, remoteSecret);

                        // 'decryptedRemoteTag' should now be the output of Automerge.save,
                        // so it's JSON stringified and ready to be put into Automerge.load()
                        // (used in Dogtag.getInstance)
                        const remoteTag = await Helpers.withErrHandling(Dogtag.getInstance, decryptedRemoteTag, user);

                        const decryptedLocalTag = await Helpers.withErrHandling(Doggo.api.decrypt, USER_LOCAL_TAG_FILE_PATH);
                        const localTag = await Helpers.withErrHandling(Dogtag.getInstance, decryptedLocalTag, user);

                        const diff = Dogtag.diff(remoteTag, localTag);

                        if (!diff.length) {
                            log('');
                            log('Remote and local tags are equal!');
                        }
                        else {
                            // TODO need to do a super security upgrade on this merge
                            // Who knows what's in that remoteTag?
                            // At _least_ assert a Joi schema
                            // OK here's what we'll do. For your uploaded default dog-tag,
                            // we'll have you set a password for it and encrypt it symmetrically
                            // problem solved!
                            const mergedTag = Dogtag.merge(localTag, remoteTag);

                            await Helpers.withErrHandling(Dogtag.encryptAndSave, USER_LOCAL_TAG_FILE_PATH, user.fingerprint, mergedTag);

                            log('');
                            log('Merged remote tag with local default tag!');

                            const encryptedMergedTag = await Helpers.withErrHandling(Doggo.api.encrypt, user.fingerprint, await Helpers.withErrHandling(Dogtag.getAutomergeSave, mergedTag));

                            await Helpers.withErrHandling(RemoteManager.updateSecret, syncJwt, remoteToSync, {
                                secret: encryptedMergedTag,
                                name: DEFAULT_DOG_TAG_NAME
                            });

                            log('');
                            log('Uploaded merged tag to remote!');
                        }
                    }
                    else {
                        // Grab the secret and upload it
                        // TODO stream this up instead of loading it in memory here
                        await Helpers.withErrHandling(RemoteManager.addSecret, syncJwt, remoteToSync, {
                            secret: await Fs.readFile(USER_LOCAL_TAG_FILE_PATH, { encoding: 'utf8' }),
                            name: DEFAULT_DOG_TAG_NAME,
                            type: 'dog-tag'
                        });

                        log('');
                        log('Uploaded default tag to remote!');
                    }

                    log('');
                    log(`Synced with server "${remoteToSync}"!`);

                    break;
                }
            }

            break;
        }

        default:
            log(`help\n`);
            log(`${internals.usage(ctx)}`);
    }

    // Space
    log('');

    // case 'key':
    // case 'keys': {

    //     Helpers.assert(subCommand, new DisplayError(displayArgs(command)));

    //     switch (subCommand) {

    //         case 'gen':
    //         case 'add':

    //             const genIdentifier = await Helpers.prompt('Enter user identifier for new keys');

    //             log(await Helpers.withErrHandling(Doggo.api.genKeys, genIdentifier));
    //             break;

    //         case 'list':

    //             log(await Helpers.withErrHandling(Doggo.api.listKeys, user, type));
    //             break;

    //         case 'import':

    //             log(await Helpers.withErrHandling(Doggo.api.importKey, path, type, password));
    //             break;

    //     default:
    //         const errMsg = command ? `Unknown command: "${command}"` : 'No command entered';
    //         log(`${internals.usage(ctx)}\n\n`);
    //         log(`${errMsg}\n`);
    //         break;
    // }
};

internals.definition = {
    h: {
        type: 'help',
        alias: 'help',
        description: 'show usage options',
        default: null
    },
    v: {
        type: 'boolean',
        alias: 'version',
        description: 'doggo-cli version',
        default: null
    }
};

internals.spaces = (numSpaces) => ' '.repeat(numSpaces);

internals.save = async (path, data) => {

    await Util.promisify(Fs.writeFile)(path, data);

    return data;
};

internals.usageText = (ctx) => {

    const { spaces } = internals;

    const commands = Object.entries(internals.commandArgs).map(([cmd, args]) => { // Note the spacing at the beginning of this line is very important

        const flexSpacing = COMMANDS_SPACING - cmd.length;
        return `\n${spaces(INDENT_SPACING)}${cmd}:${spaces(INDENT_SPACING)}${spaces(flexSpacing)}${args}`;
    }).join('');

    return `doggo <command> [options];\n\nCommands:\n${commands}`;
};

internals.usage = (ctx) => Bossy.usage(internals.definition, internals.usageText(ctx), { colors: true });

internals.commandDescription = (config) => {
    // Only allow 'regular' objects to continue
    if (!config || typeof config === 'string' || String(config) !== '[object Object]') {
        return config || '';
    }

    const { subCommands } = config;
    return `(${subCommands.join(', ')})`;
};

internals.commandArgs = {
    debt: internals.commandDescription({
        subCommands: ['add', 'list', 'delete', 'import', 'export']
    }),
    sync: internals.commandDescription('')
    // debt: internals.commandDescription('<source-path|text> [output-path]'),
};

internals.ensureLocalRemotes = async ({ fingerprint }) => {

    const USER_LOCAL_REMOTES_PATH = LOCAL_REMOTES_PATH(fingerprint);

    if (!await Helpers.fileExists(USER_LOCAL_REMOTES_PATH)) {

        // Ensure intermediate directories for USER_LOCAL_TAG_FILE_PATH
        await Util.promisify(Mkdirp)(USER_LOCAL_REMOTES_PATH.split('/').slice(0, -1).join('/'));
        await internals.encryptAndSave(USER_LOCAL_REMOTES_PATH, fingerprint, RemoteManager.init());
    }

    return USER_LOCAL_REMOTES_PATH;
};

process.on('uncaughtException', (err) => {

    console.log('UNCAUGHT', err);
});
