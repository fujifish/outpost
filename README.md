# Outpost

Outpost is a remote module installation, management and monitoring agent. When outpost is installed on a machine,
it is capable of installing, configuring, starting, stopping and monitoring various modules.

An outpost module is just a fancy name for a container of executables, files and control scripts. The control scripts are used
by outpost to manage the lifecycle of a module.

When we say *remote management*, we mean that the main use case for using outpost is managing outpost modules lifecycle
through [fortitude](https://github.com/capriza/fortitude), which is the outpost server.
Fortitude provides complete visibility into all running outpost agents,
the modules every outpost is managing and their state. It provides the ability to centrally and remotely
control the lifecycle and state of every module.

Outpost can also be used standalone without fortitude, controlling it through the command line directly on the
machine where outpost is installed.

## Why?

This whole thing may ring a bell to those familiar with
"[Infrastructure Automation and Configuration Management](https://en.wikipedia.org/wiki/Comparison_of_open-source_configuration_management_software)"
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
When you cloud services many customers, outpost and fortitude can be plugged-in to your application data to reflect
additional information about the outpost agent - such as which customer the specific outpost agent is servicing.

## Installing

Installing for testing and development is different than distributing to customers.

### Testing and Development

Outpost is a plain old node module, so installing it is done like any other node module:

```
node install outpost
```

### Distribution

When installing outpost on a customer infrastructure, there are some things we have to consider. For instance,
we can't assume that the customer has network access to npm, or that node is even installed on the machine.

For that reason, it is usually necessary to pack outpost with the node executable into another distributable
form such as a tar file. Place the node executable in the root folder of the outpost agent installation.

```
- <install dir>
 |- bin
 |- lib
 |- package.json
 |- node

```

In addition, you'd probably want to add an upstart script for starting outpost on machine start up, but this
is out of scope.

#### Agent Self Update

Outpost agent is capable of self-updating. Supporting outpost agent self-update requires that the outpost agent be
installed in a directory named `outpost-current`, for example `/opt/outpost/outpost-current`.
Place the configuration file in the parent directory of `outpost-current` so that the updated version of outpost will
locate it as well. See [Configuration] for details of the configuration file.

```
- outpost-current
 |- bin
 |- lib
 |- package.json
 |- node

```

## Configuring

After installation it's necessary to configure outpost:

```
bin/outpost agent init
```

This will launch an interactive series of questions to provide configuration parameters.

* _Agent name_ (name) - The display name this agent will have in fortitude. It's just for display purposes.
* _Root folder_ (root) - this is the directory that will hold the outpost data files. This should be *outside* the
                  outpost installation directory
* _Registry url_ (registry) - the url for the modules registry. Outpost downloads modules from this url when installing a module
* _Fortitude url_ (fortitude) - this is the fortitude server url. Leave blank if outpost should be in standalone mode
* _Fortitude authentication key_ (auth) - authentication key to identify outpost with fortitude. This would normally be different
between customers
* _Fortitude sync frequency_ (syncFrequency) - how often outpost should synchronize with fortitude (in seconds). 0 disables synchronization.
* _Proxy url_ (proxy) - if outpost should go through a proxy for network access
* _Internal CLI port_ (cliport) - the cli port outpost opens to allow control through the command line. No need to change the
default unless there is a conflict with a different server running on the same machine.

Selecting 'yes' to save the configuration will create an `opconfig.json` file in the current directory.
To save the opconfig.json file elsewhere, add the `--output <location>` flag to the agent init command.

It's also possible to provide default values by specifying the configuration value on the command line:

```
bin/outpost agent init --name "Company X" --auth "very_secret_key_for_company_x"
```

## Starting

Once configured, start outpost by running `bin/outpost agent start`. When starting, outpost searches for the configuration
file by traversing the directories upwards until it finds a file named `opconfig.json`.



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

