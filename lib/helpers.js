'use strict';

const { promises: Fs } = require('fs');
const Bounce = require('@hapi/bounce');
const Enquirer = require('enquirer');
// Constants
const { FILE_NAME_LENGTH_LIMIT } = require('./constants');

exports.assert = (bool, err) => {

    if (![].concat(bool).every((b) => !!b)) {
        if (err instanceof Error) {
            throw err;
        }

        throw new Error(String(err));
    }
};

exports.ensureArgs = async (args = {}) => {

    const argsClone = { ...args };

    const keys = Object.keys(args);

    for (let i = 0; i < keys.length; ++i) {
        const key = keys[i];
        argsClone[key] = args[key] || await exports.prompt(`Enter ${key}`);
    }

    return argsClone;
};

exports.getLogger = (out) => {

    return (...logs) => {

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

            out.write(`${logItem}\n`);
        });
    };
};

exports.prompt = async (msg, type, choices) => {

    let input;

    while (!input && input !== false) {
        ({ input } = await Enquirer.prompt([{
            type: type || 'input',
            name: 'input',
            message: msg,
            choices
        }]));
    }

    return input;
};

// Awful implementation of checking if a file exists. Copied from doggo-adapter-gpg
// TODO fix this mess
exports.fileExists = async (path) => {

    const toThrow = new Error(`File "${path}" does not exist`);

    if (!path) {
        throw toThrow;
    }

    try {
        if (path.length <= FILE_NAME_LENGTH_LIMIT) {
            await Fs.readFile(path, { encoding: 'utf8' });

            return true;
        }
    }
    catch (err) {
        Bounce.ignore(err, { code: 'ENOENT' });

        return false;
    }
};

exports.withErrHandling = async (func, ...args) => {

    const res = await func(...args);

    let error;
    let output;

    if (Array.isArray(res)) {
        // Valid assignments
        ([error, output] = res);
    }
    else if (res instanceof Object && Object.keys(res).length) {
        // Valid assignments
        ({ output, error } = res);
    }

    if (error) {
        if (error instanceof Error) {
            throw error;
        }

        throw new Error(error);
    }

    return output;
};
