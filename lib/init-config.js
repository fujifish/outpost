var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var prompt = require('prompt');

function initConfig(defaults, cb) {

  defaults = defaults || {};

  var schema = {
    properties: {
      name: {
        description: 'Agent name',
        message: 'the agent name can only contain letters, digits, spaces, dashes and underscores',
        type: 'string',
        required: true,
        default: defaults.name,
        pattern: /^[a-zA-Z0-9\s\-_]+$/
      },
      root: {
        description: 'Root folder for outpost files',
        message: 'please specify an existing folder',
        type: 'string',
        default: defaults.root || path.resolve(__dirname, '../..'),
        conform: function (value) {
          try {
            fs.readdirSync(value);
            return true;
          } catch (err) {
            return false;
          }
        }
      },
      registry: {
        description: 'Registry url',
        message: 'please specify a valid url',
        type: 'string',
        required: true,
        default: defaults.registry,
        pattern: /^(https?:\/\/|file:).+$/
      },
      homebase: {
        description: 'Homebase url',
        message: 'please specify a valid url',
        type: 'string',
        default: defaults.homebase,
        pattern: /^https?:\/\/.+$/
      },
      key: {
        description: 'Homebase authentication key',
        message: 'please specify the homebase authentication key',
        type: 'string',
        default: defaults.key
      }
    }
  };

  prompt.message = 'outpost';

  prompt.start();

  function _prompt() {

    console.log('-----------------------------------------');
    prompt.get(schema, function (err, result) {
      if (!result) {
        cb(result);
        return;
      }

      result.id = defaults.id || crypto.randomBytes(6).toString('hex');

      console.log('-----------------------------------------');
      console.log('This is configuration that will be saved:');
      console.log(JSON.stringify(result, null, 2));

      prompt.confirm({
        description: 'Save configuration? (y/n)',
        pattern: /^[ynYN]$/
      }, function (err, yes) {
        if (err) {
          process.exit(1);
        }
        if (yes === true) {
          console.log('-----------------------------------------');
          cb(result);
        } else {
          _prompt();
        }
      });

    });
  }

  _prompt();
}

exports.initConfig = module.exports.initConfig = initConfig;