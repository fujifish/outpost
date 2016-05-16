
var fs = require('fs');
var util = require('util');
var path = require('path');


function pad(str) {
  str = '  ' + str;
  while (str.length < 16) str += ' ';
  return str;
}

function exit(code) {
  process.exit(code);
}

function parseConfig(config) {
  try {
    config = config || '{}';
    config = config.trim();
    if (config.charAt(0) !== '{') {
      var baseDir = path.resolve(__dirname, '..');
      config = fs.readFileSync(path.resolve(baseDir, config))
    }
    return JSON.parse(config);
  } catch (err) {
    usage('config is not valid: ' + err.message);
  }
}

/**
 * the available commands for outpost
 */
var baseCommands = {

  install: {
    desc: 'install a module',
    usage: '<module> [options]',
    help: 'Please specify a full module name in the form "name@version"',
    options: {
      config: {
        desc: 'install configuration. can be a file path or a complete parseable JSON string',
        type: 'string'
      }
    },
    actions: true, // must have some action following the command
    process: function(module, options) {
      var config = options.config;
      if (config) {
        config = parseConfig(config);
      }

      return {
        type: 'install',
        module: module,
        config: config
      }
    }
  },

  uninstall: {
    desc: 'uninstall a module',
    usage: '<module> [options]',
    help: 'Please specify a module name',
    options: {
      config: {
        desc: 'uninstall configuration. can be a file path or a complete parseable JSON string',
        type: 'string'
      }
    },
    actions: true, // must have some action following the command
    process: function(module, options) {
      var config = options.config;
      if (config) {
        config = parseConfig(config);
      }

      return {
        type: 'uninstall',
        module: module,
        config: config
      }
    }
  },

  configure: {
    desc: 'configure a module',
    usage: '<module> [options]',
    help: 'Please specify a module name',
    options: {
      config: {
        desc: 'module configuration to apply. can be a file path or a complete parseable JSON string',
        required: true, // this option is required
        type: 'string'
      }
    },
    actions: true, // must have some action following the command
    process: function(module, options) {

      return {
        type: 'configure',
        module: module,
        config: parseConfig(options.config)
      }
    }
  },

  start: {
    desc: 'start a module',
    usage: '<module> [options]',
    help: 'Please specify a module name',
    options: {
      config: {
        desc: 'start configuration. can be a file path or a complete parseable JSON string',
        type: 'string'
      }
    },
    actions: true,
    process: function(module, options) {
      var config = options.config;
      if (config) {
        config = parseConfig(config);
      }

      return {
        type: 'start',
        module: module,
        config: config
      }
    }
  },
  stop: {
    desc: 'stop a module',
    usage: '<module> [options]',
    help: 'Please specify a module name',
    options: {
      config: {
        desc: 'stop configuration. can be a file path or a complete parseable JSON string',
        type: 'string'
      }
    },
    actions: true,
    process: function(module, options) {
      var config = options.config;
      if (config) {
        config = parseConfig(config);
      }

      return {
        type: 'stop',
        module: module,
        config: config
      }
    }
  },
  reset: {
    desc: 'reset all installed modules',
    usage: 'all',
    help: 'Please specify the "all" parameter',
    options: {
    },
    actions: true,
    process: function(param) {
      if (param !== 'all') {
        usage('must specify "all" as the reset parameter', 'reset');
      }

      return {
        type: 'reset',
        action: param
      }
    }
  },
  state: {
    desc: 'outpost state management',
    usage: '<action> [options]',
    help: 'Please specify an action for state',
    actions: {
      apply: {
        desc: 'apply the specified state'
      },
      show: {
        desc: 'show the current state',
        process: function(options) {
          if (options.format && ["table", "json", "raw"].indexOf(options.format) === -1) {
            usage('"' + options.format + '" is not a valid format for "state show"', 'state');
          }
          return {
            type: 'state',
            action: 'show',
            silent: true,
            format: options.format
          }
        }
      }
    },
    options: {
      state: {
        desc: 'the state. can be a file path or a complete parseable JSON string',
        required: ['apply'], // this options is required
        type: 'string'
      },
      format: {
        desc: 'the format to show the current state. valid values are "table", "json" or "raw"',
        type: 'string'
      }
    },
    process: function(action, options) {
      return {
        type: 'state',
        action: action,
        state: options.state
      }
    }
  },
  sync: {
    desc: 'synchronize outpost with fortitude',
    help: '',
    process: function(action, options) {
      return {
        type: 'sync'
      }
    }
  },
  status: {
    desc: 'show current status of installed modules',
    help: '',
    process: function(action, options) {
      return {
        type: 'state',
        action: 'show',
        silent: true,
        format: 'table'
      }
    }
  },
  module: {
    desc: 'create and manage outpost modules',
    usage: '<action> [options]',
    help: 'Please specify an action for module',
    actions: {
      pack: {
        desc: 'create a packaged module that can be installed by outpost'
      }
    },
    options: {
      sign: {
        desc: 'the private key file (containing the hex key) used for signing the module. specify "false" to skip signing',
        type: 'string',
        required: true
      },
      dir: {
        desc: 'the module directory to pack. this directory is expected to contain a module.json file. defaults to "module"',
        type: 'string'
      },
      out: {
        desc: 'the directory where the output module is to be written. defaults to "."',
        type: 'string'
      },
      platform: {
        desc: 'pack the module as platform specific. the module file name will contain the current platform',
        type: 'boolean'
      }
    },
    process: function(action, options) {
      return {
        type: 'module',
        action: action,
        moduleDir: options.dir || 'module',
        outdir: options.out || '.',
        platform: options.platform,
        signWith: options.sign
      }
    }
  },
  genkeys: {
    desc: 'generate a private/public key pair that can be used for signing modules',
    usage: '[options]',
    options: {
      curve: {
        desc: 'the EC curve to use (one of secp256k1, p192, p224, p256, p384, p521). default is "secp256k1"',
        type: 'string'
      }
    },
    process: function(action, options) {
      return {
        type: 'genkeys',
        curve: options.curve || 'secp256k1'
      }
    }
  },
  agent: {
    desc: 'control the outpost agent',
    usage: '<action> [options]',
    help: 'Please specify an action for agent',
    actions: {
      start: {
        desc: 'start the agent'
      },
      stop: {
        desc: 'stop the agent'
      },
      restart: {
        desc: 'restart the agent'
      },
      init: {
        desc: 'ask for agent configuration settings'
      },
      config: {
        desc: 'show configuration'
      },
      update: {
        desc: 'update the agent to a new version',
        process: function(options) {
          return {
            type: 'update',
            version: options.version
          }
        }
      },
      unregister: {
        desc: 'unregister the agent with fortitude',
        process: function() {
          return {
            type: 'unregister'
          }
        }
      },
      version: {
        desc: 'print the current version of the agent'
      }
    },
    options: {
      version: {
        desc: 'the version for updating the agent',
        required: ['update'], // this option is required for the 'update' action only
        type: 'string'
      },
      output: {
        desc: 'where to save the configuration during init',
        type: 'string'
      }
    },
    process: function(action, options) {
      return {
        type: 'agent',
        action: action,
        options: options
      }
    }
  },
  help: {
    desc: 'show usage information for a command, e.g. "outpost help agent"',
    usage: '<command>',
    help: 'Please specify a valid command to see extended usage information',
    process: function(command) {
      if (!command) {
        usage();
      }

      if (!baseCommands[command]) {
        usage('\'' + command + '\' is not a valid command of outpost');
      }

      usage('', command);
    }
  }
};

/**
 * The common available options for outpost
 */
var baseOptions = {
  opconfig: {
    desc: 'outpost configuration. can be a file path or a complete parseable JSON string'
  },
  force: {
    desc: 'force the operation'
  },
  silent: {
    desc: 'do not show the log'
  },
  wait: {
    desc: 'wait for the current running command to finish instead of returning an error'
  }
};

/**
 * format the usage report for the specified command and optional message
 */
function usage(message, commandName) {
  var usageMessage = 'Usage: outpost <command> [options]';
  var commands = baseCommands;
  var options = baseOptions;
  var command = commands[commandName];
  var title = 'Commands';

  // show usage information for a specific command
  if (command) {
    usageMessage = 'Usage: outpost ' + commandName + ' ' + command.usage;
    title = 'Actions';
    commands = command.actions;
    if (typeof commands !== 'object') {
      commands = {};
    }
    options = util._extend(command.options || {}, options);
  }

  // print the complete usage information
  console.log(usageMessage + '\n');

  if (Object.keys(commands).length > 0) {
    console.log(title + ':');
    Object.keys(commands).forEach(function(c) {
      var command = pad(c);
      console.log(command + commands[c].desc);
    });
    console.log('');
  }

  console.log('Options:');
  Object.keys(options).forEach(function(o) {
    var option = pad('--' + o);
    var requiredFor = '';
    if (options[o].required) {
      requiredFor = '[*] ';
      if (Array.isArray(options[o].required)) {
        requiredFor = '[' + options[o].required + '] ';
      }
    }
    console.log(option + requiredFor + options[o].desc);
  });
  console.log('');

  console.log(message || (command && command.help) || 'See "outpost help <command>" for more information on a specific command.');
  exit(1);
}


/**
 * Process command line arguments
 */
function processArgs() {
  var argv = require('minimist')(process.argv.slice(2));

  if (argv._.length === 0) {

    // check if we have the undocumented --daemon option present
    if (argv.daemon) {
      return {
        type: 'daemon',
        opConfig: argv.opconfig
      }
    }

    usage();
  }

  // remove the command
  var command = argv.command = argv._.shift();
  if (!baseCommands[command]) {
    usage('\'' + command + '\' is not a valid outpost command');
  }

  // check the action
  var action = argv._.shift();
  var actions = baseCommands[command].actions;
  if (actions !== undefined && ((actions === true && !action) || (actions !== true && !actions[action]))) {
    usage(null, command);
  }

  // check options
  var options = baseCommands[command].options;
  if (options) {
    Object.keys(options).forEach(function(option) {
      // if an option is required
      if (options[option].required && !argv[option]) {
        if ((options[option].required === true) || // required for all actions
          (Array.isArray(options[option].required) && options[option].required.indexOf(action) !== -1)) { // required for specific actions only
          usage('Missing required option \'' + option + '\'', command);
        }
      }

      if (argv[option] && (typeof argv[option] !== (options[option].type || 'boolean'))) {
        usage('Invalid option value for \'' + option + '\'', command);
      }
    });
  }

  // process the command
  var com;
  try {
    com = baseCommands[command].actions[action].process(argv);
  } catch(e) {
    // ignore the error, it's because there is no action processor
    com = baseCommands[command].process(action, argv);
  }
  com.opConfig = com.opConfig || argv.opconfig;
  com.force = com.force || argv.force;
  com.silent = com.silent || argv.silent;
  com.wait = com.wait || argv.wait;
  return com;
}

exports.process = module.exports.process = processArgs;