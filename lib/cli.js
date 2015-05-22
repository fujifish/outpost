
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

/**
 * the available commands for outpost
 */
var baseCommands = {
  install: {
    desc: 'install a module',
    usage: '<module> [options]',
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
    help: ''
  },
  start: {
    desc: 'start a module',
    help: ''
  },
  stop: {
    desc: 'stop a module',
    help: ''
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
    desc: 'outpost configuration. can be a file path or a complete parseable configuration string'
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
    options = util._extend(options, command.options);
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
    console.log(option + options[o].desc);
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