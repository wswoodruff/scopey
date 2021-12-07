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
    INVALID_ARGS
} = require('./constants');

// Pull .env into process.env
Dotenv.config({ path: `${__dirname}/../.env` });

const internals = {};

exports.start = (options) => {

    const args = Bossy.parse(internals.definition, {
        argv: options.argv
    });

    const log = Helpers.getLogger(options.out);
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

    const showHelp = () => log(`${internals.usage(ctx, log)}`);

    if (help) {
        showHelp();
        return;
    }

    const [,,,subCommand] = extraArgs;

    switch (command) {
        case 'help':
            showHelp();
            break;
        default:
            showHelp();
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

internals.usage = (ctx, log) => {

    log('======================');
    log('Help');
    log('======================\n');

    return Bossy.usage(internals.definition, internals.usageText(ctx), { colors: true })
};

internals.commandDescription = (config) => {
    // Only allow 'regular' objects to continue
    if (!config || typeof config === 'string' || String(config) !== '[object Object]') {
        return config || '';
    }

    const { subCommands } = config;
    return `(${subCommands.join(', ')})`;
};

internals.commandArgs = {
    debt: internals.commandDescription('subcommands: manage, analyze')
    // debt: internals.commandDescription('<source-path|text> [output-path]'),
};

process.on('uncaughtException', (err) => {

    console.log('UNCAUGHT', err);
});
