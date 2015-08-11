# Outpost

Outpost is a remote module installation, management and monitoring agent. When outpost is installed on a machine,
it is capable of installing, configuring, starting, stopping and monitoring various modules.

When we say *remote management*, we mean that the main use case for using outpost is managing outpost modules lifecycle
through [fortitude](https://github.com/capriza/fortitude), which is the outpost server.

[Fortitude](https://github.com/capriza/fortitude) provides complete visibility into all running outpost agents,
the modules that every outpost is managing and the outpost agent state. It provides the ability to centrally and remotely
control the lifecycle and state of every module in every agent.

Outpost can also be controlled from the command line directly on the machine where outpost is installed.

## Why?

This whole thing may ring a bell to those familiar with
[infrastructure automation and configuration management](https://en.wikipedia.org/wiki/Comparison_of_open-source_configuration_management_software)"
tools such as Puppet, Chef, SaltStack and Ansible.

Outpost is different. It is not intended for automating the configuration and management of *infrastructure*.
Outpost is used to automate the lifecycle of *application level* software. The primary use case is for controlling
software that's installed outside of your own infrastructure, most notably on a customers infrastructure. This software
may still connect to your cloud service, but installing it on an infrastructure that's not your own creates
several problems:

* Visibility - it's difficult to track what's installed, where and for whom
* Supportability - it's difficult to know when something goes wrong, or what went wrong
* Maintainability - it's difficult to perform changes and upgrades

Installing outpost and connecting it to a fortitude server, it's possible to get all
the visibility, supportability and maintainability we need.

### So Why Not Use Puppet/Chef/SaltStack/Ansible?

Because these tools assume you have complete control over the infrastructure. If you can access the machine and
install the tool agent on it then it's yours for the taking. You can do whatever you want with it.
This is very much not the case when dealing with infrastructure that's not yours.

Security and authorization is also a very big issue when installing on a customers infrastructure.
An outpost agent must authenticate and authorize with fortitude to get things done, whereas IT management tools usually do not
have this restriction.

Outpost is also designed to provide visibility into the application level of your cloud service.
When your cloud app provides services to many customers, outpost and fortitude can be plugged-in to your application data to reflect
additional information about the outpost agent - such as which customer the specific outpost agent is servicing.

## Outpost Agent

The outpost agent is responsible for performing the following:

* Perform commands received from the command line
* Periodically synchronize of the fortitude server
* Monitor module processes and relaunch failed processes (similar to what [monit](https://mmonit.com/monit/) does)

### Agent Installation

Installing for testing and development is different than distributing to customers.

#### Testing and Development Environments

Outpost is a plain old node module, so installing it is done like any other node module:

```
node install outpost
```

#### Production Environments and Distribution

When installing outpost on a customer infrastructure, there are some things we have to consider. For instance,
we can't assume that the customer has network access to npm, or that node is even installed on the machine.

For that reason, it is usually necessary to pack outpost with the node executable into another distributable
form such as a tar file. Place the node executable in the root folder of the outpost agent installation.

```
<install dir>
 |- bin
 |- lib
 |- package.json
 |- node

```

In addition, you'd probably want to add an upstart script for starting outpost on machine start up, but this
is out of scope of this documentation.

#### Self Update

Outpost agent is capable of self-updating. Supporting outpost agent self-update requires that the outpost agent be
installed in a directory named `outpost-current`, for example `/opt/outpost/outpost-current`.
Place the configuration file in the parent directory of `outpost-current` so that the updated version of outpost will
locate it as well. See [Configuration] for details of the configuration file.

```
-<parent dir>
  |-outpost-current
  |  |- bin
  |  |- lib
  |  |- package.json
  |  |- node
  |-opconfig.json

```

### Agent Configuration

Outpost configuration is maintained in a file named `opconfig.json`. Outpost locates this file by traversing the
directories upwards until it finds the file, so placing it in the parent directory of the outpost installation is the
preferred location.

#### Configuration Fields

* `name` - Agent name - the display name this agent will have in fortitude. It's just for display purposes.
* `root` - Root folder - this is the directory that will hold the outpost data files. This should be *outside* the
outpost installation directory
* `registry` - Registry url - the url for the modules registry. Outpost downloads modules from this url when installing a module
* `fortitude` - Fortitude url - this is the fortitude server url. Leave blank if outpost should be in standalone mode
* `auth` - Fortitude authentication key - authentication key to identify outpost with fortitude. This would normally be different
between customers
* `syncFrequency` - Fortitude sync frequency - how often outpost should synchronize with fortitude (in seconds).
0 disables synchronization completely.
* `proxy` - Proxy url - if outpost should go through a proxy for network access
* `cliport` - Internal CLI port - the cli port outpost opens to allow control through the command line. No need to change the
default unless there is a conflict with a different server running on the same machine.
* `id` - the unique identity of this agent

#### Interactive Configuration

It's possible to interactively configure outpost by running:

```
bin/outpost agent init
```

This will launch an interactive series of questions to provide configuration parameters.

After all fields have been filled, selecting 'yes' to save the configuration will create an `opconfig.json`
file in the current directory. To save the opconfig.json file elsewhere, add the `--output <location>` flag
to the agent init command.

It's also possible to provide default values by specifying the configuration value on the command line:

```
bin/outpost agent init --name "Company X" --auth "very_secret_key_for_company_x"
```

### Agent Start

To start outpost, run:

```
bin/outpost agent start
```

This will launch the outpost agent in daemon mode.

### Agent Stop

To start outpost, run:

```
bin/outpost agent stop
```

This will stop the outpost agent.

## Modules

An outpost module is a container of executables, files and control scripts. The control scripts are used
by outpost to manage the lifecycle of a module.

The identity of a module consists of a name and a version, and the combination of the two uniquely identify the module.

The full name of a module is unique, and has the form `<name>@<version>`.

### Module Anatomy

A module is a tar.gz file with a unique identity.

The complete name of the module binary is `<name>-<version>[-<platform>].tar.gz`.
`platform` is optional, and it distinguishes between different module distribution per platform.
Supported platforms are `linux`, `darwin` and `win32`.

A module must contain a `module.json` file in it's root, and it contains definitions about the module:

* `name` [required] - the module name
* `version` [required] - the module version
* `scripts` [optional] - a list of lifecycle control scripts
* `submodules` [optional] - an array of modules that this modules depends on
* `schema` [optional] - a JSON schema describing the input fields that fortitude should display for configuring this module. This
is never required, it simply helps to display the module configuration parameters in fortitude.

Here is a complete module.json example of a redis module:

```
{
  "name": "redis",
  "version": "2.8.19",
  "submodules": [],
  "scripts": {
    "configure": "configure.js",
    "start": "start.js",
    "stop": "stop.js"
  },
  "schema": {
    "configure": {
      "port": {"type": "integer", "title": "Redis Port", "default": 6379, "minimum": 1025, "maximum": 65535, "required": true}
    }
  }
}

```

In this case, the full name of the module is `redis@2.8.19`.

### Modules Registry

Modules are hosted in *modules registry*. The registry is a static file http server that outpost contacts
to download modules. It can even be an [AWS S3 bucket](https://aws.amazon.com/s3/).

The path to a module inside the registry is `<registry url>/<name>/<name-version>/<name-version[-platform]>.tar.gz`.

For example:

```
<registry>
  |- redis
  |  |- redis-2.8.19
  |  |  |- redis-2.8.19-linux.tar.gz
  |  |  |- redis-2.8.19-darwin.tar.gz
  |- logrotate
  |  |- logrotate-3.9.0
  |  |  |- logrotate-3.9.0-linux.tar.gz
  |  |  |- logrotate-3.9.0-darwin.tar.gz
```

### Module Lifecycle

A module lifecycle consists of the following phases:

* `install` - installation of the module
* `configure` - configuration of the module after it was installed
* `start` - start the module after it was configured
* `stop` - stop the module if it is started
* `uninstall` - uninstall the module if it is installed

A module contains a single script that outpost will run for every lifecycle phase.
The script to run is defined in `module.json` under the `scripts` element. Specifying a lifecycle script is completely
optional:

```
"scripts": {
  "configure": "configure.js",
  "start": "start.js",
  "stop": "stop.js",
}

```

In this example, no script will run during the `install` and `uninstall` phases, but outpost will execute the
corresponding scripts during the `configure`, `start` and `stop` phases.

#### Install Phase

The install phase is the first phase in the life of a module. Installing a module requires specifying the full name
of the module:

```
bin/outpost install <name>@<version>
```

Outpost relies on the `registry` and the `root` folder defined in the outpost configuration for installing a module.

Outpost performs the following steps to install a module:

* Search for the module package in the registry. It first tries platform specific package, and if it's not found
then outpost searches for the generic version.
* Download the module from the registry and save it to the `cache` folder (inside the root folder)
* Unpack the module to the `modules` folder (inside the root folder)
* Recursively download all submodules that are defined in the `module.json` file
* Execute the `install` phase script of the downloaded module

#### Configure Phase

The configure phase is the second phase in the life of a module. This phase is responsible for performing any and all
configuration tasks of the installed module.

It is not required to specify the full name of the module. Specifying just the module name causes outpost to search for
an installed module with that name, and if only one version is installed, it is selected as the module to configure.

The configuration itself can either be a path to a file containing the configuration, or a complete JSON string.

```
# configure using full module name
bin/outpost configure <name>@<version> --config <configuration>

# configure using just the module name
bin/outpost configure <name> --config <configuration>
```

Outpost performs the following steps to configure a module:

* Search for the installed module in the `modules` directory (by full name or short name)
* Execute the `configure` script of the module passing it the specified configuration

## License

The MIT License (MIT)

Copyright (c) 2015 Capriza Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

