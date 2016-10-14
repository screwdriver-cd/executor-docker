# Docker Swarm Executor
[![Version][npm-image]][npm-url] ![Downloads][downloads-image] [![Build Status][status-image]][status-url] [![Open Issues][issues-image]][issues-url] [![Dependency Status][daviddm-image]][daviddm-url] ![License][license-image]

> Docker Swarm Executor for Screwdriver

This is an executor for the Screwdriver CD solution that interacts with Docker Swarm (and Docker locally).

## Usage

```bash
npm install screwdriver-executor-s3m
```

### Initialization

The class has a variety of knobs to tweak when interacting with your Swarm instance.

| Parameter        | Type  |  Description |
| :-------------   | :---- | :-------------|
| config        | Object | Configuration Object |
| config.docker | Object | [Dockerode configuration][dockerode] |
| config.ecosystem | Object | Screwdriver Ecosystem (ui, api, store, etc.) |
| config.fusebox | Object | [Circuit Breaker configuration][circuitbreaker] |
| config.launchVersion | String | Launcher container version to use (stable) |
```js
const executor = new S3mExecutor({
    docker: {
        socketPath: '/var/lib/docker.sock'
    },
    launchVersion: 'stable'
});
```

### Methods

For more information on `start`, `stop`, and `stats` please see the [executor-base-class].

## Testing

```bash
npm test
```

## License

Code licensed under the BSD 3-Clause license. See LICENSE file for terms.

[npm-image]: https://img.shields.io/npm/v/screwdriver-executor-s3m.svg
[npm-url]: https://npmjs.org/package/screwdriver-executor-s3m
[downloads-image]: https://img.shields.io/npm/dt/screwdriver-executor-s3m.svg
[license-image]: https://img.shields.io/npm/l/screwdriver-executor-s3m.svg
[issues-image]: https://img.shields.io/github/issues/screwdriver-cd/executor-s3m.svg
[issues-url]: https://github.com/screwdriver-cd/executor-s3m/issues
[status-image]: https://cd.screwdriver.cd/pipelines/3d10806f51927f28b4a690c8153499a277b29397/badge
[status-url]: https://cd.screwdriver.cd/pipelines/3d10806f51927f28b4a690c8153499a277b29397
[daviddm-image]: https://david-dm.org/screwdriver-cd/executor-s3m.svg?theme=shields.io
[daviddm-url]: https://david-dm.org/screwdriver-cd/executor-s3m
[dockerode]: https://www.npmjs.com/package/dockerode#getting-started
[circuitbreaker]: https://www.npmjs.com/package/circuit-fuses#constructor
[executor-base-class]: https://github.com/screwdriver-cd/executor-base
