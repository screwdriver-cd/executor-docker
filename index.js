'use strict';

/* eslint no-underscore-dangle: ["error", { "allowAfterThis": true }] */
const Executor = require('screwdriver-executor-base');
const hoek = require('hoek');
const Fusebox = require('circuit-fuses');
const Docker = require('dockerode');

class S3mExecutor extends Executor {
    /**
     * Constructor
     * @method constructor
     * @param  {Object} options                                  Configuration options
     * @param  {Object} options.docker                           Docker configuration
     * @param  {String} [options.docker.protocol]                Protocol to use
     * @param  {String} [options.docker.host]                    Docker Swarm host to interact with
     * @param  {String} [options.docker.port]                    Port number
     * @param  {String} [options.docker.socketPath]              Docker socket to use
     * @param  {String} [options.docker.ca]                      Certificate authority
     * @param  {String} [options.docker.cert]                    Certificate to use
     * @param  {String} [options.docker.key]                     Key for the certificate
     * @param  {Object} [options.fusebox]                        Fusebox configuration
     * @param  {Object} [options.fusebox.breaker]                Breaker configuration
     * @param  {Number} [options.fusebox.breaker.timeout=300000] Timeout before retrying
     * @param  {String} [options.launchVersion=stable]           Launcher container version to use
     * @param  {String} [options.logVersion=stable]              Log Service container version to use
     */
    constructor(options) {
        super();

        this.docker = new Docker(options.docker);
        this.launchVersion = options.launchVersion || 'stable';
        this.logVersion = options.logVersion || 'stable';
        this.breaker = new Fusebox((func, cb) => func(cb), hoek.applyToDefaults({
            breaker: {
                timeout: 5 * 60 * 1000 // Default to 5 minute timeout
            }
        }, options.fusebox));
    }

    /**
     * Create a Docker container
     * @method _createContainer
     * @param  {Object}   options Docker container options
     * @return {Promise}          Docker container object
     */
    _createContainer(options) {
        return new Promise((resolve, reject) => {
            this.breaker.runCommand(cb => this.docker.createContainer(options, cb),
                (err, container) => (err ? reject(err) : resolve(container))
            );
        });
    }

    /**
     * Start a Docker container
     * @method _startContainer
     * @param  {Container}   container Docker container to start
     * @return {Promise}
     */
    _startContainer(container) {
        return new Promise((resolve, reject) => {
            this.breaker.runCommand(cb => container.start(cb),
                err => (err ? reject(err) : resolve())
            );
        });
    }

    /**
     * Remove a Docker container
     * @method _removeContainer
     * @param  {Container}   container Docker container to remove
     * @return {Promise}
     */
    _removeContainer(container) {
        return new Promise((resolve, reject) => {
            this.breaker.runCommand(cb => container.remove({ v: true, force: true }, cb),
                err => (err ? reject(err) : resolve())
            );
        });
    }

    /**
     * Find Docker containers
     * @method _findContainers
     * @param  {String}   buildId Build ID to find
     * @return {Promise}          List of containers
     */
    _findContainers(buildId) {
        const listArgs = {
            filters: JSON.stringify({
                label: [
                    `sdbuild=${buildId}`
                ]
            }),
            all: true
        };

        return new Promise((resolve, reject) => {
            this.breaker.runCommand(cb => this.docker.listContainers(listArgs, cb),
                (err, containers) => (err ? reject(err) : resolve(containers))
            );
        });
    }

    /**
     * Starts a s3m build
     * @method _start
     * @param  {Object}   config            A configuration object
     * @param  {String}   config.buildId    ID for the build
     * @param  {String}   config.container  Container for the build to run in
     * @param  {String}   config.apiUri     API Uri
     * @param  {String}   config.token      JWT for the Build
     * @return {Promise}
     */
    _start(config) {
        return this._createContainer(
            {
                name: `${config.buildId}-init`,
                Image: `screwdrivercd/launcher:${this.launchVersion}`,
                Entrypoint: '/bin/true',
                Labels: {
                    sdbuild: config.buildId
                }
            })
            .then(launchContainer => Promise.all([
                this._createContainer({
                    name: `${config.buildId}-log`,
                    Image: `screwdrivercd/log-service:${this.logVersion}`,
                    Entrypoint: '/opt/screwdriver/tini',
                    Labels: {
                        sdbuild: config.buildId
                    },
                    Cmd: [
                        '--',
                        '/opt/screwdriver/logservice',
                        '--emitter',
                        '/opt/screwdriver/emitter',
                        config.buildId
                    ],
                    Env: [
                        `SD_TOKEN=${config.token}`
                    ],
                    HostConfig: {
                        // 200 MB of memory
                        Memory: 200 * 1024 * 1024,
                        // 300 MB of memory + swap (aka, 100 MB of swap)
                        MemoryLimit: 300 * 1024 * 1024,
                        VolumesFrom: [
                            `${launchContainer.id}:rw`
                        ]
                    }
                }),
                this._createContainer({
                    name: `${config.buildId}-build`,
                    Image: config.container,
                    Entrypoint: '/opt/screwdriver/tini',
                    Labels: {
                        sdbuild: config.buildId
                    },
                    Cmd: [
                        '--',
                        '/opt/screwdriver/launch',
                        '--api-uri',
                        config.apiUri,
                        '--emitter',
                        '/opt/screwdriver/emitter',
                        config.buildId
                    ],
                    Env: [
                        `SD_TOKEN=${config.token}`
                    ],
                    HostConfig: {
                        // 2 GB of memory
                        Memory: 2 * 1024 * 1024 * 1024,
                        // 3 GB of memory + swap (aka, 1 GB of swap)
                        MemoryLimit: 3 * 1024 * 1024 * 1024,
                        VolumesFrom: [
                            `${launchContainer.id}:rw`
                        ]
                    }
                })
            ]))
            .then(([logContainer, buildContainer]) => Promise.all([
                this._startContainer(logContainer),
                this._startContainer(buildContainer)
            ]));
    }

    /**
     * Stop a s3m build
     * @method _stop
     * @param  {Object}   config            A configuration object
     * @param  {String}   config.buildId    ID for the build
     * @return {Promise}
     */
    _stop(config) {
        return this._findContainers(config.buildId)
            .then(containers => Promise.all(containers.map(container =>
                this._removeContainer(container))));
    }

    /**
    * Retreive stats for the executor/breaker
    * @method stats
    * @param  {Response} Object Object containing stats for the executor/breaker
    */
    stats() {
        return {
            requests: {
                total: this.breaker.getTotalRequests(),
                timeouts: this.breaker.getTimeouts(),
                success: this.breaker.getSuccessfulRequests(),
                failure: this.breaker.getFailedRequests(),
                concurrent: this.breaker.getConcurrentRequests(),
                averageTime: this.breaker.getAverageRequestTime()
            },
            breaker: {
                isClosed: this.breaker.isClosed()
            }
        };
    }
}

module.exports = S3mExecutor;
