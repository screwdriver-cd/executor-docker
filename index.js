'use strict';

/* eslint no-underscore-dangle: ["error", { "allowAfterThis": true }] */
const Executor = require('screwdriver-executor-base');
const hoek = require('hoek');
const Fusebox = require('circuit-fuses');
const Docker = require('dockerode');

class DockerExecutor extends Executor {
    /**
     * Constructor
     * @method constructor
     * @param  {Object} options                                  Configuration options
     * @param  {Object} options.ecosystem                        Screwdriver Ecosystem
     * @param  {Object} options.ecosystem.api                    Routable URI to Screwdriver API
     * @param  {Object} options.ecosystem.store                  Routable URI to Screwdriver Store
     * @param  {Object} [options.docker]                         Docker configuration
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
     */
    constructor(options) {
        super();

        this.ecosystem = options.ecosystem;
        this.docker = new Docker(options.docker);
        this.launchVersion = options.launchVersion || 'stable';
        this.breaker = new Fusebox((obj, cb) => obj.func(cb), hoek.applyToDefaults({
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
        return this.breaker.runCommand({
            func: cb => this.docker.createContainer(options, cb)
        });
    }

    /**
     * Create a Docker image
     * @method _createImage
     * @param  {Object}   options Docker image options
     * @return {Promise}          Docker image object
     */
    _createImage(options) {
        return this.breaker.runCommand({
            func: cb => this.docker.createImage(options, cb)
        });
    }

    /**
     * Start a Docker container
     * @method _startContainer
     * @param  {Container}   container Docker container to start
     * @return {Promise}
     */
    _startContainer(container) {
        return this.breaker.runCommand({
            func: cb => container.start(cb)
        });
    }

    /**
     * Remove a Docker container
     * @method _removeContainer
     * @param  {Container}   container Docker container to remove
     * @return {Promise}
     */
    _removeContainer(container) {
        return this.breaker.runCommand({
            func: cb => container.remove({ v: true, force: true }, cb)
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

        return this.breaker.runCommand({
            func: cb => this.docker.listContainers(listArgs, cb)
        }).then(containers => containers.map(container => this.docker.getContainer(container.Id)));
    }

    /**
     * Starts a docker build
     * @method _start
     * @param  {Object}   config            A configuration object
     * @param  {String}   config.buildId    ID for the build
     * @param  {String}   config.container  Container for the build to run in
     * @param  {String}   config.token      JWT for the Build
     * @return {Promise}
     */
    _start(config) {
        const [buildImage, buildTag] = config.container.split(':');

        return Promise.all(
            [
                this._createImage({
                    fromImage: 'screwdrivercd/launcher',
                    tag: this.launchVersion
                }),
                this._createImage({
                    fromImage: buildImage,
                    tag: buildTag || 'latest'
                })
            ])
            .then(() => this._createContainer({
                name: `${config.buildId}-init`,
                Image: `screwdrivercd/launcher:${this.launchVersion}`,
                Entrypoint: '/bin/true',
                Labels: {
                    sdbuild: config.buildId
                }
            }))
            .then(launchContainer => this._createContainer({
                name: `${config.buildId}-build`,
                Image: config.container,
                Entrypoint: '/opt/screwdriver/tini',
                Labels: {
                    sdbuild: config.buildId
                },
                Cmd: [
                    '--',
                    // Run a shell command
                    '/bin/sh',
                    '-c',
                    [
                        // Run the launcher in the background
                        '/opt/screwdriver/launch',
                        '--api-uri',
                        this.ecosystem.api,
                        '--emitter',
                        '/opt/screwdriver/emitter',
                        config.buildId,
                        '&',
                        // Run the logservice in the background
                        '/opt/screwdriver/logservice',
                        '--emitter',
                        '/opt/screwdriver/emitter',
                        '--api-uri',
                        this.ecosystem.store,
                        '--build',
                        config.buildId,
                        '&',
                        // Wait for both background jobs to complete
                        'wait $(jobs -p)'
                    ].join(' ')
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
            }))
            .then(buildContainer => this._startContainer(buildContainer));
    }

    /**
     * Stop a docker build
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
        return this.breaker.stats();
    }
}

module.exports = DockerExecutor;
