'use strict';

/* eslint no-underscore-dangle: ["error", { "allowAfterThis": true }] */
const Executor = require('screwdriver-executor-base');
const hoek = require('@hapi/hoek');
const imageParser = require('docker-parse-image');
const Fusebox = require('circuit-fuses').breaker;
const Docker = require('dockerode');

const DEFAULT_BUILD_TIMEOUT = 90; // 90 minutes

class DockerExecutor extends Executor {
    /**
     * Constructor
     * @method constructor
     * @param  {Object} options                                      Configuration options
     * @param  {Object} options.ecosystem                            Screwdriver Ecosystem
     * @param  {Object} options.ecosystem.api                        Routable URI to Screwdriver API
     * @param  {Object} options.ecosystem.store                      Routable URI to Screwdriver Store
     * @param  {Object} options.ecosystem.ui                         Routable URI to Screwdriver UI
     * @param  {Object} [options.docker]                             Docker configuration
     * @param  {String} [options.docker.protocol]                    Protocol to use
     * @param  {String} [options.docker.host]                        Docker Swarm host to interact with
     * @param  {String} [options.docker.port]                        Port number
     * @param  {String} [options.docker.socketPath]                  Docker socket to use
     * @param  {String} [options.docker.ca]                          Certificate authority
     * @param  {String} [options.docker.cert]                        Certificate to use
     * @param  {String} [options.docker.key]                         Key for the certificate
     * @param  {Object} [options.fusebox]                            Fusebox configuration
     * @param  {Object} [options.fusebox.breaker]                    Breaker configuration
     * @param  {Number} [options.fusebox.breaker.timeout=300000]     Timeout before retrying
     * @param  {String} [options.launchImage=screwdrivercd/launcher] Launcher container version to use
     * @param  {String} [options.launchVersion=stable]               Launcher container version to use
     * @param  {String} [options.prefix=""]                          Prefix to all container names
     */
    constructor(options) {
        super();

        this.ecosystem = options.ecosystem;
        this.docker = new Docker(options.docker);
        this.launchVersion = options.launchVersion || 'stable';
        this.launchImage = options.launchImage || 'screwdrivercd/launcher';
        this.prefix = options.prefix || '';

        const breakerOptions = hoek.applyToDefaults(
            {
                breaker: {
                    maxFailures: 10,
                    timeout: 5 * 60 * 1000 // Default to 5 minute timeout,
                }
            },
            options.fusebox || {}
        );

        this.breaker = new Fusebox((obj, cb) => obj.func(cb), breakerOptions);
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
     * @param  {Integer}  buildId Build ID to find
     * @return {Promise}          List of containers
     */
    _findContainers(buildId) {
        const listArgs = {
            filters: JSON.stringify({
                label: [`sdbuild=${this.prefix}${buildId}`]
            }),
            all: true
        };

        return this.breaker
            .runCommand({
                func: cb => this.docker.listContainers(listArgs, cb)
            })
            .then(containers => containers.map(container => this.docker.getContainer(container.Id)));
    }

    /**
     * Starts a docker build
     * @method _start
     * @param  {Object}   config            A configuration object
     * @param  {String}   [config.apiUri]   screwdriver base api uri
     * @param  {Integer}  config.buildId    ID for the build
     * @param  {String}   config.container  Container for the build to run in
     * @param  {String}   config.token      JWT for the Build
     * @return {Promise}
     */

    _start(config) {
        const piecesParts = imageParser(config.container);
        let buildTag = piecesParts.tag;
        let buildImage = piecesParts.name;
        const buildTimeout = hoek.reach(config, 'annotations>screwdriver.cd/timeout', { separator: '>' });
        const timeout = parseInt(buildTimeout || DEFAULT_BUILD_TIMEOUT, 10);

        /**
         *
         * the docker-parse-image returns a fullname that always contains
         * a namespace, which defaults to 'library' if no namespace is specified.
         * perhaps library is the historical place to put things? but,
         * my private registry does not work with 'library' injected in to the
         * docker image name.  In other words, if I try to parse:
         * 'myregistry.private.com/myimage'
         * i end up with
         * 'myregistry.private.com/library/myimage:latest'
         * there is no library namespace in my private registry, so this fails.
         */
        if (piecesParts.tag !== null && piecesParts.tag !== 'latest') {
            const containerNameParts = piecesParts.name.split(':');

            containerNameParts.pop();
            buildImage = containerNameParts.join(':');
        } else {
            buildTag = 'latest';
        }

        return Promise.all([
            this._createImage({
                fromImage: this.launchImage,
                tag: this.launchVersion
            }),
            this._createImage({
                fromImage: buildImage,
                tag: buildTag
            })
        ])
            .then(() =>
                this._createContainer({
                    name: `${this.prefix}${config.buildId}-init`,
                    Image: `${this.launchImage}:${this.launchVersion}`,
                    Entrypoint: '/bin/true',
                    Labels: {
                        sdbuild: `${this.prefix}${config.buildId}`
                    }
                })
            )
            .then(launchContainer =>
                this._createContainer({
                    name: `${this.prefix}${config.buildId}-build`,
                    Image: config.container,
                    Entrypoint: '/opt/sd/launcher_entrypoint.sh',
                    Labels: {
                        sdbuild: `${this.prefix}${config.buildId}`
                    },
                    Cmd: [
                        [
                            // Run the wrapper script
                            '/opt/sd/run.sh',
                            `"${config.token}"`,
                            this.ecosystem.api,
                            this.ecosystem.store,
                            timeout,
                            config.buildId,
                            this.ecosystem.ui
                        ].join(' ')
                    ],
                    HostConfig: {
                        // 2 GB of memory
                        Memory: 2 * 1024 * 1024 * 1024,
                        // 3 GB of memory + swap (aka, 1 GB of swap)
                        MemoryLimit: 3 * 1024 * 1024 * 1024,
                        VolumesFrom: [`${launchContainer.id}:rw`],
                        Privileged: true,
                        Binds: ['/var/run/docker.sock:/var/run/docker.sock']
                    }
                })
            )
            .then(buildContainer => this._startContainer(buildContainer));
    }

    /**
     * Stop a docker build
     * @method _stop
     * @param  {Object}   config            A configuration object
     * @param  {String}   [config.apiUri]   screwdriver base api uri
     * @param  {Integer}  config.buildId    ID for the build
     * @return {Promise}
     */
    _stop(config) {
        return this._findContainers(config.buildId).then(containers =>
            Promise.all(containers.map(container => this._removeContainer(container)))
        );
    }

    /**
     * Starts a new periodic build in an executor
     * @method _startPeriodic
     * @return {Promise}  Resolves to null since it's not supported
     */
    _startPeriodic() {
        return Promise.resolve(null);
    }

    /**
     * Stops a new periodic build in an executor
     * @method _stopPeriodic
     * @return {Promise}  Resolves to null since it's not supported
     */
    _stopPeriodic() {
        return Promise.resolve(null);
    }

    /**
     * Starts a new frozen build in an executor
     * @method _startFrozen
     * @return {Promise}  Resolves to null since it's not supported
     */
    _startFrozen() {
        return Promise.resolve(null);
    }

    /**
     * Stops a new frozen build in an executor
     * @method _stopFrozen
     * @return {Promise}  Resolves to null since it's not supported
     */
    _stopFrozen() {
        return Promise.resolve(null);
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
