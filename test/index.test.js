'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const mockery = require('mockery');

require('sinon-as-promised');

sinon.assert.expose(assert, { prefix: '' });

describe('index', function () {
    // Time not important. Only life important.
    this.timeout(5000);

    let Executor;
    let dockerodeMock;
    let dockerMock;
    let containerMock;
    let containerShellMock;
    let executor;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        containerMock = {
            id: 'containerID',
            start: sinon.stub().yieldsAsync(),
            remove: sinon.stub().yieldsAsync()
        };
        containerShellMock = {
            id: 'containerID'
        };
        dockerMock = {
            createContainer: sinon.stub().yieldsAsync(null, containerMock),
            createImage: sinon.stub().yieldsAsync(null),
            listContainers: sinon.stub().yieldsAsync(null, [containerShellMock]),
            getContainer: sinon.stub().returns(containerMock)
        };
        dockerodeMock = sinon.stub().returns(dockerMock);

        mockery.registerMock('dockerode', dockerodeMock);

        /* eslint-disable global-require */
        Executor = require('../index');
        /* eslint-enable global-require */

        executor = new Executor({
            ecosystem: {
                api: 'api',
                ui: 'ui',
                store: 'store'
            },
            docker: {
                host: 'docker-swarm'
            },
            fusebox: {
                breaker: {
                    timeout: 1
                },
                retry: {
                    retries: 1,
                    minTimeout: 1
                }
            }
        });
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    describe('constructor', () => {
        it('passes options to Dockerode', () => {
            assert.calledWith(dockerodeMock, {
                host: 'docker-swarm'
            });
        });

        it('defaults to stable containers', () => {
            assert.equal(executor.launchVersion, 'stable');
            assert.equal(executor.prefix, '');
        });

        it('supports customizing containers', () => {
            executor = new Executor({
                launchVersion: 'v1.2.3',
                prefix: 'beta_'
            });

            assert.equal(executor.launchVersion, 'v1.2.3');
            assert.equal(executor.prefix, 'beta_');
        });
    });

    describe('start', () => {
        const buildId = 1992;
        const apiUri = 'https://api.sd.cd';
        const token = '123456';
        let container = 'node:6';
        const launcherImageArgs = {
            fromImage: 'screwdrivercd/launcher',
            tag: 'stable'
        };
        let buildArgs;
        let launcherContainer;
        let launcherArgs;
        let buildContainer;

        beforeEach(() => {
            launcherContainer = {
                id: 'launcherID',
                start: sinon.stub().yieldsAsync(new Error()),
                remove: sinon.stub().yieldsAsync(new Error())
            };
            launcherArgs = {
                name: `${buildId}-init`,
                Image: 'screwdrivercd/launcher:stable',
                Entrypoint: '/bin/true',
                Labels: {
                    sdbuild: buildId.toString()
                }
            };
            buildContainer = {
                id: 'buildID',
                start: sinon.stub().yieldsAsync(null),
                remove: sinon.stub().yieldsAsync(new Error())
            };
            buildArgs = {
                name: `${buildId}-build`,
                Image: container,
                Entrypoint: '/opt/sd/tini',
                Labels: {
                    sdbuild: buildId.toString()
                },
                Cmd: [
                    '--',
                    '/bin/sh',
                    '-c', [
                        '/opt/sd/launch',
                        '--api-uri',
                        'api',
                        '--store-uri',
                        'store',
                        '--emitter',
                        '/opt/sd/emitter',
                        buildId,
                        '&',
                        '/opt/sd/logservice',
                        '--emitter',
                        '/opt/sd/emitter',
                        '--api-uri',
                        'store',
                        '--build',
                        buildId,
                        '&',
                        'wait $(jobs -p)'
                    ].join(' ')
                ],
                Env: [
                    `SD_TOKEN=${token}`
                ],
                HostConfig: {
                    Memory: 2 * 1024 * 1024 * 1024,
                    MemoryLimit: 3 * 1024 * 1024 * 1024,
                    VolumesFrom: [
                        'launcherID:rw'
                    ]
                }
            };
        });

        it('creates the required containers and starts them', () => {
            const buildImageArgs = {
                fromImage: 'node',
                tag: '6'
            };

            dockerMock.createContainer.yieldsAsync(new Error('bad container args'));
            dockerMock.createContainer.withArgs(launcherArgs)
                .yieldsAsync(null, launcherContainer);
            dockerMock.createContainer.withArgs(buildArgs)
                .yieldsAsync(null, buildContainer);

            return executor.start({
                buildId, container, apiUri, token
            }).then(() => {
                assert.calledWith(dockerMock.createImage, buildImageArgs);
                assert.calledWith(dockerMock.createImage, launcherImageArgs);
                assert.callCount(dockerMock.createImage, 2);
                assert.calledWith(dockerMock.createContainer, buildArgs);
                assert.calledWith(dockerMock.createContainer, launcherArgs);
                assert.callCount(dockerMock.createContainer, 2);
                assert.callCount(buildContainer.start, 1);
            });
        });

        it('supports prefixed containers', () => {
            const prefix = 'beta_';
            const buildImageArgs = {
                fromImage: 'node',
                tag: '6'
            };

            launcherArgs = {
                name: `${prefix}${buildId}-init`,
                Image: 'screwdrivercd/launcher:stable',
                Entrypoint: '/bin/true',
                Labels: {
                    sdbuild: `${prefix}${buildId}`
                }
            };
            buildArgs = {
                name: `${prefix}${buildId}-build`,
                Image: container,
                Entrypoint: '/opt/sd/tini',
                Labels: {
                    sdbuild: `${prefix}${buildId}`
                },
                Cmd: [
                    '--',
                    '/bin/sh',
                    '-c', [
                        '/opt/sd/launch',
                        '--api-uri',
                        'api',
                        '--store-uri',
                        'store',
                        '--emitter',
                        '/opt/sd/emitter',
                        buildId,
                        '&',
                        '/opt/sd/logservice',
                        '--emitter',
                        '/opt/sd/emitter',
                        '--api-uri',
                        'store',
                        '--build',
                        buildId,
                        '&',
                        'wait $(jobs -p)'
                    ].join(' ')
                ],
                Env: [
                    `SD_TOKEN=${token}`
                ],
                HostConfig: {
                    Memory: 2 * 1024 * 1024 * 1024,
                    MemoryLimit: 3 * 1024 * 1024 * 1024,
                    VolumesFrom: [
                        'launcherID:rw'
                    ]
                }
            };

            dockerMock.createContainer.yieldsAsync(new Error('bad container args'));
            dockerMock.createContainer.withArgs(launcherArgs)
                .yieldsAsync(null, launcherContainer);
            dockerMock.createContainer.withArgs(buildArgs)
                .yieldsAsync(null, buildContainer);

            executor = new Executor({
                prefix,
                ecosystem: {
                    api: 'api',
                    ui: 'ui',
                    store: 'store'
                }
            });

            return executor.start({
                buildId, container, apiUri, token
            }).then(() => {
                assert.calledWith(dockerMock.createImage, buildImageArgs);
                assert.calledWith(dockerMock.createImage, launcherImageArgs);
                assert.callCount(dockerMock.createImage, 2);
                assert.calledWith(dockerMock.createContainer, buildArgs);
                assert.calledWith(dockerMock.createContainer, launcherArgs);
                assert.callCount(dockerMock.createContainer, 2);
                assert.callCount(buildContainer.start, 1);
            });
        });

        it('creates containers without specifying a tag', () => {
            const buildImageArgs = {
                fromImage: 'node',
                tag: 'latest'
            };

            container = 'node';
            buildArgs.Image = container;

            dockerMock.createContainer.yieldsAsync(new Error('bad container args'));
            dockerMock.createContainer.withArgs(launcherArgs)
                .yieldsAsync(null, launcherContainer);
            dockerMock.createContainer.withArgs(buildArgs)
                .yieldsAsync(null, buildContainer);

            return executor.start({
                buildId, container, apiUri, token
            }).then(() => {
                assert.calledWith(dockerMock.createImage, buildImageArgs);
                assert.calledWith(dockerMock.createImage, launcherImageArgs);
                assert.callCount(dockerMock.createImage, 2);
                assert.calledWith(dockerMock.createContainer, buildArgs);
                assert.calledWith(dockerMock.createContainer, launcherArgs);
                assert.callCount(dockerMock.createContainer, 2);
                assert.callCount(buildContainer.start, 1);
            });
        });

        it('creates containers from a private docker registry and starts them', () => {
            const buildImageArgs = {
                fromImage: 'docker-registry.foo.bar:1111/someImage',
                tag: 'latest'
            };

            container = 'docker-registry.foo.bar:1111/someImage:latest';
            buildArgs.Image = container;

            dockerMock.createContainer.yieldsAsync(new Error('bad container args'));
            dockerMock.createContainer.withArgs(launcherArgs)
                .yieldsAsync(null, launcherContainer);
            dockerMock.createContainer.withArgs(buildArgs)
                .yieldsAsync(null, buildContainer);

            return executor.start({
                buildId, container, apiUri, token
            }).then(() => {
                assert.calledWith(dockerMock.createImage, buildImageArgs);
                assert.calledWith(dockerMock.createImage, launcherImageArgs);
                assert.callCount(dockerMock.createImage, 2);
                assert.calledWith(dockerMock.createContainer, buildArgs);
                assert.calledWith(dockerMock.createContainer, launcherArgs);
                assert.callCount(dockerMock.createContainer, 2);
                assert.callCount(buildContainer.start, 1);
            });
        });

        it('creates containers from a private docker registry without specifying a tag', () => {
            const buildImageArgs = {
                fromImage: 'docker-registry.foo.bar:1111/someImage',
                tag: 'latest'
            };

            container = 'docker-registry.foo.bar:1111/someImage';
            buildArgs.Image = container;

            dockerMock.createContainer.yieldsAsync(new Error('bad container args'));
            dockerMock.createContainer.withArgs(launcherArgs)
                .yieldsAsync(null, launcherContainer);
            dockerMock.createContainer.withArgs(buildArgs)
                .yieldsAsync(null, buildContainer);

            return executor.start({
                buildId, container, apiUri, token
            }).then(() => {
                assert.calledWith(dockerMock.createImage, buildImageArgs);
                assert.calledWith(dockerMock.createImage, launcherImageArgs);
                assert.callCount(dockerMock.createImage, 2);
                assert.calledWith(dockerMock.createContainer, buildArgs);
                assert.calledWith(dockerMock.createContainer, launcherArgs);
                assert.callCount(dockerMock.createContainer, 2);
                assert.callCount(buildContainer.start, 1);
            });
        });

        it('bubbles create problems back', () => {
            dockerMock.createContainer.yieldsAsync(new Error('Unable to create container'));

            return executor.start({
                buildId, container, apiUri, token
            }).then(() => {
                throw new Error('should not have gotten here');
            }).catch((error) => {
                assert.equal(error.message, 'Unable to create container');
            });
        });

        it('bubbles start problems back', () => {
            containerMock.start.yieldsAsync(new Error('Unable to start container'));

            return executor.start({
                buildId, container, apiUri, token
            }).then(() => {
                throw new Error('should not have gotten here');
            }).catch((error) => {
                assert.equal(error.message, 'Unable to start container');
            });
        });
    });

    describe('stop', () => {
        const buildId = 1992;

        it('finds and removes the containers', () => {
            const findArgs = {
                filters: `{"label":["sdbuild=${buildId}"]}`,
                all: true
            };
            const removeArgs = {
                v: true,
                force: true
            };

            dockerMock.listContainers.yieldsAsync(new Error('bad container args'));
            dockerMock.listContainers.withArgs(findArgs)
                .yieldsAsync(null, [containerShellMock, containerShellMock]);

            return executor.stop({
                buildId
            }).then(() => {
                assert.calledWith(dockerMock.listContainers, findArgs);
                assert.calledWith(containerMock.remove, removeArgs);
                assert.callCount(containerMock.remove, 2);
            });
        });

        it('supports prefixes', () => {
            const prefix = 'beta_';
            const findArgs = {
                filters: `{"label":["sdbuild=${prefix}${buildId}"]}`,
                all: true
            };
            const removeArgs = {
                v: true,
                force: true
            };

            dockerMock.listContainers.yieldsAsync(new Error('bad container args'));
            dockerMock.listContainers.withArgs(findArgs)
                .yieldsAsync(null, [containerShellMock, containerShellMock]);

            executor = new Executor({
                prefix,
                ecosystem: {
                    api: 'api',
                    ui: 'ui',
                    store: 'store'
                }
            });

            return executor.stop({
                buildId
            }).then(() => {
                assert.calledWith(dockerMock.listContainers, findArgs);
                assert.calledWith(containerMock.remove, removeArgs);
                assert.callCount(containerMock.remove, 2);
            });
        });

        it('bubbles list problems back', () => {
            dockerMock.listContainers.yieldsAsync(new Error('Unable to list containers'));

            return executor.stop({
                buildId
            }).then(() => {
                throw new Error('should not have gotten here');
            }).catch((error) => {
                assert.equal(error.message, 'Unable to list containers');
            });
        });

        it('bubbles remove problems back', () => {
            containerMock.remove.yieldsAsync(new Error('Unable to remove container'));

            return executor.stop({
                buildId
            }).then(() => {
                throw new Error('should not have gotten here');
            }).catch((error) => {
                assert.equal(error.message, 'Unable to remove container');
            });
        });
    });

    describe('stats', () => {
        it('bubbles stats from circuit fuses', () => {
            assert.deepEqual({
                requests: {
                    total: 0,
                    timeouts: 0,
                    success: 0,
                    failure: 0,
                    concurrent: 0,
                    averageTime: 0
                },
                breaker: {
                    isClosed: true
                }
            }, executor.stats());
        });
    });
});
