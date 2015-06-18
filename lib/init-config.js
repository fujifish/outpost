var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var prompt = require('prompt');
var Outpost = require('./outpost');

function initConfig(defaults, cb) {


  prompt.message = '';

  prompt.start();

  function _prompt(defaults) {

    defaults = defaults || {};

    var schema = {
      properties: {
        name: {
          description: 'Agent name',
          message: 'The agent name can only contain letters, digits, spaces, dashes and underscores',
          type: 'string',
          required: true,
          default: defaults.name,
          pattern: /^[a-zA-Z0-9\s\-_]+$/
        },
        root: {
          description: 'Root folder for outpost files',
          message: 'Please specify an existing folder',
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
          message: 'Please specify a valid url',
          type: 'string',
          required: true,
          default: defaults.registry,
          pattern: /^(https?:\/\/|file:).+$/
        },
        homebase: {
          description: 'Homebase url',
          message: 'Please specify a valid url',
          type: 'string',
          default: defaults.homebase,
          pattern: /^https?:\/\/.+$/
        },
        key: {
          description: 'Homebase authentication key',
          message: 'Please specify the homebase authentication key',
          type: 'string',
          default: defaults.key,
          required: true,
          ask: function() {
            var homebase = prompt.history('homebase');
            return homebase && homebase.value.length > 0;
          }
        },
        proxy: {
          description: 'Proxy url',
          message: 'Please specify a valid url',
          type: 'string',
          default: defaults.proxy,
          pattern: /^https?:\/\/.+$/
        },
        proxyAuthType: {
          description: 'Proxy authentication type (basic/ntlm)',
          message: 'Please specify "basic", "ntlm" or leave it blank for no authentication',
          type: 'string',
          default: defaults.proxyAuthType,
          pattern: /^(basic|ntlm)?$/,
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
          pattern: /^[A-Za-z0-9_]$/,
          ask: function() {
            var proxyAuthType = prompt.history('proxyAuthType');
            return proxyAuthType && proxyAuthType.value.length === 'ntlm';
          }
        },
        cliport: {
          description: 'Internal CLI server port',
          message: 'Please specify a valid port',
          required: true,
          default: Outpost.prototype.CLIPORT,
          pattern: /^[0-9]{1,5}$/
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