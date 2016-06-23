var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var prompt = require('prompt');

function initConfig(defaults, cb) {


  prompt.message = '';

  prompt.start();

  function _prompt(defaults) {

    defaults = defaults || {};

    var schema = {
      properties: {
        name: {
          description: 'Agent name [optional]',
          message: 'The agent name can only contain letters, digits, spaces, dashes and underscores',
          type: 'string',
          required: false,
          default: defaults.name,
          pattern: /^[a-zA-Z0-9\s\-_\.]+$/
        },
        root: {
          description: 'Root folder for outpost files',
          message: 'Please specify an existing folder',
          type: 'string',
          required: true,
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
          message: 'Please specify a valid url',
          type: 'string',
          required: true,
          default: defaults.registry,
          pattern: /^(https?:\/\/|file:).+$/
        },
        sigPubKey: {
          description: 'Modules signature public key',
          message: 'Please specify a valid 33 byte hex string',
          type: 'string',
          required: true,
          default: defaults.sigPubKey,
          pattern: /^\.$|^[0-9a-fA-F]{66}$/ // the hex is 33 bytes, the first byte is a marker followed by 32 bytes of the key
        },
        fortitude: {
          description: 'Fortitude url',
          message: 'Please specify a valid url',
          type: 'string',
          default: defaults.fortitude,
          pattern: /^\.$|^https?:\/\/.+$/
        },
        auth: {
          description: 'Fortitude authentication key',
          message: 'Please specify the fortitude authentication key',
          type: 'string',
          default: defaults.auth,
          required: true,
          ask: function() {
            var fortitude = prompt.history('fortitude');
            return fortitude && fortitude.value.length > 0;
          }
        },
        syncFrequency: {
          description: 'Fortitude sync frequency (in seconds, 0 to disable)',
          message: 'Please specify a number over 30 or 0 to disable',
          type: 'string',
          default: defaults.syncFrequency || '0',
          required: true,
          ask: function() {
            var fortitude = prompt.history('fortitude');
            return fortitude && fortitude.value.length > 0;
          },
          conform: function (value) {
            if (!value.match('^[0-9]+$')) {
              return false;
            }
            var val = parseInt(value);
            return val === 0 || val >= 30;
          }
        },
        proxy: {
          description: 'Proxy url [optional]',
          message: 'Please specify a valid url',
          type: 'string',
          default: defaults.proxy,
          pattern: /^\.$|^https?:\/\/.+$/
        },
        proxyAuthType: {
          description: 'Proxy authentication type (basic/ntlm)',
          message: 'Please specify "basic", "ntlm" or leave it blank for no authentication',
          type: 'string',
          default: defaults.proxyAuthType,
          pattern: /^\.$|^(basic|ntlm)?$/,
          ask: function() {
            var proxy = prompt.history('proxy');
            return proxy && proxy.value.length > 0;
          }
        },
        proxyNTLMDomain: {
          description: 'Proxy NTLM authentication domain',
          message: 'Please specify a valid NTLM domain',
          type: 'string',
          default: defaults.proxyNTLMDomain,
          pattern: /^\.$|^[A-Za-z0-9_]$/,
          ask: function() {
            var proxyAuthType = prompt.history('proxyAuthType');
            return proxyAuthType && proxyAuthType.value === 'ntlm';
          }
        }
      }
    };

    console.log('-----------------------------------------');
    prompt.get(schema, function (err, result) {
      if (!result) {
        cb(result);
        return;
      }

      result.id = defaults.id || crypto.randomBytes(6).toString('hex');

      console.log('-----------------------------------------');
      console.log('This is the configuration that will be saved:');

      // clear out empty values
      Object.keys(result).forEach(function(p) {
        if (typeof result[p] === 'string' && (result[p].length === 0 || result[p] === '.')) {
          delete result[p];
        }
      });

      console.log(JSON.stringify(result, null, 2));

      prompt.get({
        properties: {
          save: {
            description: 'Save configuration? (y/n)',
            message: 'Please answer with "y" or "n"',
            pattern: /^[yn]$/,
            required: true
          }
        }
      }, function (err, resp) {
        if (err) {
          process.exit(1);
        }
        if (resp.save === 'y') {
          console.log('-----------------------------------------');
          cb(result);
        } else {
          _prompt(result);
        }
      });

    });
  }

  _prompt(defaults);
}

exports.initConfig = module.exports.initConfig = initConfig;