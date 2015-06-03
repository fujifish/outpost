
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
      config = fs.readFileSync(path.resolve(__dirname, '../' + config))
    }
    config = JSON.parse(config);
    return config;
  } catch (err) {
    return null;
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
    actions: true,
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
    actions: true,
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
        required: true,
        type: 'string'
      }
    },
    actions: true,
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
  state: {
    desc: 'outpost state management',
    usage: '<action> [options]',
    help: 'Please specify an action for state',
    actions: {
      apply: {
        desc: 'apply the specified state'
      }
    },
    options: {
      state: {
        desc: 'the state. can be a file path or a complete parseable JSON string',
        required: true,
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
    desc: 'sync outpost with homebase',
    help: ''
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
      }
    },
    process: function(action, options) {
      return {
        type: 'agent',
        action: action
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
    console.log(option + (options[o].required ? '[required] ' : '') + options[o].desc);
  });
  console.log('');

  console.log(message || (command && command.help) || 'See "outpost help <command>" for more information on a specific command.');
  exit(1);
}


/**
 * Process command line arguments
 * @returns {*}
 */
function processArgs() {
  var argv = require('minimist')(process.argv.slice(2));

  if (argv._.length === 0) {

    // check if we have the undocumented --daemon option present
    if (argv.daemon) {
      if (!argv.opconfig) {
        console.log('Usage: outpost --daemon --opconfig <outpost config file or string> \n');
        console.log('Starting outpost in daemon mode requires specifying a config file or the complete configuration as a json string');
        exit(1);
      }
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
  if ((actions === true && !action) || (actions !== true && !actions[action])) {
    usage(null, command);
  }

  // check options
  var options = baseCommands[command].options;
  if (options) {
    Object.keys(options).forEach(function(option) {
      if (options[option].required && !argv[option]) {
        usage('Missing required option \'' + option + '\'', command);
      }

      if (argv[option] && (typeof argv[option] !== (options[option].type || 'boolean'))) {
        usage('Invalid option value for \'' + option + '\'', command);
      }
    });
  }

  // process the command
  var com = baseCommands[command].process(action, argv);
  com.opConfig = argv.opconfig;
  return com;
}

exports.process = module.exports.process = processArgs;