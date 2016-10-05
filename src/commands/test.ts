import {Command} from './command';

export class TestCommand implements Command {
  name = 'test';

  description = 'Runs web-component-tester';

  args = [
    {
      name: 'persistent',
      alias: 'p',
      description: 'Keep browsers active (refresh to rerun tests)',
      type: Boolean,
    },
    {
      name: 'plugin',
      description: 'Plugins that should be loaded',
      type: String,
    },
    {
      name: 'skip-plugin',
      description: 'Configured plugins that should _not_ be loaded',
      type: String,
    },
    {
      name: 'expanded',
      description: 'Log a status line for each test run',
      type: String,
    },
    {
      name: 'simpleOutput',
      description: 'Avoid fancy terminal output',
      type: String,
    },
    {
      name: 'skip-update-check',
      description: "Don't check for updates",
      type: String,
    },
    {
      name: 'webserver-port',
      description: 'A port to use for the test webserver',
      type: String,
    },
    {
      name: 'color',
      description: '',
      type: String,
    },
    {
      name: 'local',
      alias: 'l',
      description: "Local browsers to run tests on, or 'all'",
      type: String,
    },
    {
      name: 'selenium-arg',
      description: 'Additional selenium server arguments. Port is auto-selected.',
      type: String,
    },
    {
      name: 'skip-selenium-install',
      description: 'Skip trying to install selenium',
      type: String,
    },
    {
      name: 'sauce-access-key',
      description: 'Sauce Labs access key',
      type: String,
    },
    {
      name: 'sauce',
      alias: 's',
      description: "Remote Sauce Labs browsers to run tests on, or 'default'",
      type: String,
    },
    {
      name: 'build-number',
      description: 'The build number tested by this test for the sauce labs REST API',
      type: String,
    },
    {
      name: 'job-name',
      description: 'Job name for the sauce labs REST API',
      type: String,
    },
    {
      name: 'port',
      description: 'Select an alternative port for Sauce Connect (default is 4445)',
      type: String,
    },
    {
      name: 'sauce-tunnel-id',
      description: 'Sauce Connect tunnel identifier',
      type: String,
    },
    {
      name: 'sauce-username',
      description: 'Sauce Labs username',
      type: String,
    },
    {
      name: 'visibility',
      description: "Set job visibility to 'public', 'public restricted', 'share', 'team' or 'private'",
      type: String,
    },
    {
      name: 'configFile',
      description: "Config file that needs to be used by wct. ie: wct.config-sauce.js",
      type: String,
    },
  ];

  run(_options, _config): Promise<void> {
    // Defer dependency loading until this specific command is run
    const wct = require('web-component-tester');

    return wct.cli.run(process.env, process.argv.slice(3), process.stdout);
  }
}
