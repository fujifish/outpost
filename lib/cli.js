
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
    usage: '<url> [options]',
    help: 'Installing a module requires specifying a url or module name',
    process: function(url, options) {
      if (!url) {
        usage(null, 'install');
      }

      return {
        type: 'install',
        url: url
      }
    }
  },

  configure: {
    desc: 'configure a module',
    usage: '<module> --config <configuration> [options]',
    help: 'You must specify the full module name in the form <module>@<version>.',
    options: {
      config: {
        desc: 'module configuration to apply. can be a file path or a complete parseable JSON string',
        required: true
      }
    },
    process: function(module, options) {
      if (!module) {
        usage(null, 'configure');
      }

      var config = options.config;
      if (!config || typeof config !== 'string') {
        usage('Missing required option \'config\'', 'configure');
      }

      config = parseConfig(config);
      if (!config) {
        usage('Error loading configuration ' + options.config, 'configuration');
      }

      return {
        type: 'configure',
        module: module,
        config: config
      }
    }
  },

  start: {
    desc: 'start a module',
    usage: '<module> [options]',
    help: 'You must specify the full module name in the form <module>@<version>.',
    options: {
      config: {
        desc: 'start configuration. can be a file path or a complete parseable JSON string'
      }
    },
    process: function(module, options) {
      if (!module) {
        usage(null, 'start');
      }

      var config = options.config;
      if (config) {
        if (typeof config !== 'string') {
          usage('Missing value for option \'config\'', 'start');
        }
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
    help: 'You must specify the full module name in the form <module>@<version>.',
    options: {
      config: {
        desc: 'stop configuration. can be a file path or a complete parseable JSON string'
      }
    },
    process: function(module, options) {
      if (!module) {
        usage(null, 'stop');
      }

      var config = options.config;
      if (config) {
        if (typeof config !== 'string') {
          usage('Missing value for option \'config\'', 'stop');
        }
        config = parseConfig(config);
      }

      return {
        type: 'stop',
        module: module,
        config: config
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
      if (!action) {
        usage(null, 'agent');
      }

      if (!baseCommands['agent'].actions[action]) {
        usage('\'' + action + '\' is not a valid action for agent', 'agent');
      }

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
    commands = command.actions || {};
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

  // process the command
  var com = baseCommands[command].process(argv._.shift(), argv);
  com.opConfig = argv.opconfig;
  return com;
}

exports.process = module.exports.process = processArgs;