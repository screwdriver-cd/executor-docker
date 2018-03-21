# Docker Executor
[![Version][npm-image]][npm-url] ![Downloads][downloads-image] [![Build Status][status-image]][status-url] [![Open Issues][issues-image]][issues-url] [![Dependency Status][daviddm-image]][daviddm-url] ![License][license-image]

> Docker Executor for Screwdriver

This is an executor for the Screwdriver CD solution that interacts with Docker (local and remote).

## Usage

```bash
npm install screwdriver-executor-docker
```

### Initialization

The class has a variety of knobs to tweak when interacting with Docker.

| Parameter        | Type  |  Description |
| :-------------   | :---- | :-------------|
| config        | Object | Configuration Object |
| config.docker | Object | [Dockerode configuration][dockerode] |
| config.ecosystem | Object | Screwdriver Ecosystem (ui, api, store, etc.) |
| config.fusebox | Object | [Circuit Breaker configuration][circuitbreaker] |
| config.launchVersion | String | Launcher container version to use (stable) |
| config.prefix | String | Prefix to container names ("") |
```js
const executor = new DockerExecutor({
    docker: {
        socketPath: '/var/lib/docker.sock'
    },
    launchVersion: 'stable'
});
```

### Methods

For more information on `start`, `stop`, and `stats` please see the [executor-base].

## Testing

```bash
npm test
```

## License

Code licensed under the BSD 3-Clause license. See LICENSE file for terms.

[npm-image]: https://img.shields.io/npm/v/screwdriver-executor-docker.svg
[npm-url]: https://npmjs.org/package/screwdriver-executor-docker
[downloads-image]: https://img.shields.io/npm/dt/screwdriver-executor-docker.svg
[license-image]: https://img.shields.io/npm/l/screwdriver-executor-docker.svg
[issues-image]: https://img.shields.io/github/issues/screwdriver-cd/screwdriver.svg
[issues-url]: https://github.com/screwdriver-cd/screwdriver/issues
[status-image]: https://cd.screwdriver.cd/pipelines/13/badge
[status-url]: https://cd.screwdriver.cd/pipelines/13
[daviddm-image]: https://david-dm.org/screwdriver-cd/executor-docker.svg?theme=shields.io
[daviddm-url]: https://david-dm.org/screwdriver-cd/executor-docker
[dockerode]: https://www.npmjs.com/package/dockerode#getting-started
[circuitbreaker]: https://www.npmjs.com/package/circuit-fuses#constructor
[executor-base]: https://github.com/screwdriver-cd/executor-base
