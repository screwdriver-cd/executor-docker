'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const mockery = require('mockery');

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
                Entrypoint: '/opt/sd/launcher_entrypoint.sh',
                Labels: {
                    sdbuild: buildId.toString()
                },
                Cmd: [['/opt/sd/run.sh', `"${token}"`, 'api', 'store', '90', buildId, 'ui'].join(' ')],
                HostConfig: {
                    Memory: 2 * 1024 * 1024 * 1024,
                    MemoryLimit: 3 * 1024 * 1024 * 1024,
                    VolumesFrom: ['launcherID:rw'],
                    Privileged: true,
                    Binds: ['/var/run/docker.sock:/var/run/docker.sock']
                }
            };
        });

        it('creates the required containers and starts them', () => {
            const buildImageArgs = {
                fromImage: 'node',
                tag: '6'
            };

            dockerMock.createContainer.yieldsAsync(new Error('bad container args'));
            dockerMock.createContainer.withArgs(launcherArgs).yieldsAsync(null, launcherContainer);
            dockerMock.createContainer.withArgs(buildArgs).yieldsAsync(null, buildContainer);

            return executor
                .start({
                    buildId,
                    container,
                    apiUri,
                    token
                })
                .then(() => {
                    assert.calledWith(dockerMock.createImage, buildImageArgs);
                    assert.calledWith(dockerMock.createImage, launcherImageArgs);
                    assert.callCount(dockerMock.createImage, 2);
                    assert.calledWith(dockerMock.createContainer, buildArgs);
                    assert.calledWith(dockerMock.createContainer, launcherArgs);
                    assert.callCount(dockerMock.createContainer, 2);
                    assert.callCount(buildContainer.start, 1);
                });
        });

        it('creates the containers with correct args from build config', () => {
            const buildImageArgs = {
                fromImage: 'node',
                tag: '6'
            };

            buildArgs.Cmd = [['/opt/sd/run.sh', `"${token}"`, 'api', 'store', 5, buildId, 'ui'].join(' ')];

            dockerMock.createContainer.yieldsAsync(new Error('bad container args'));
            dockerMock.createContainer.withArgs(launcherArgs).yieldsAsync(null, launcherContainer);
            dockerMock.createContainer.withArgs(buildArgs).yieldsAsync(null, buildContainer);

            return executor
                .start({
                    buildId,
                    container,
                    apiUri,
                    token,
                    annotations: {
                        'screwdriver.cd/timeout': 5
                    }
                })
                .then(() => {
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
                Entrypoint: '/opt/sd/launcher_entrypoint.sh',
                Labels: {
                    sdbuild: `${prefix}${buildId}`
                },
                Cmd: [['/opt/sd/run.sh', `"${token}"`, 'api', 'store', '90', buildId, 'ui'].join(' ')],
                HostConfig: {
                    Memory: 2 * 1024 * 1024 * 1024,
                    MemoryLimit: 3 * 1024 * 1024 * 1024,
                    VolumesFrom: ['launcherID:rw'],
                    Privileged: true,
                    Binds: ['/var/run/docker.sock:/var/run/docker.sock']
                }
            };

            dockerMock.createContainer.yieldsAsync(new Error('bad container args'));
            dockerMock.createContainer.withArgs(launcherArgs).yieldsAsync(null, launcherContainer);
            dockerMock.createContainer.withArgs(buildArgs).yieldsAsync(null, buildContainer);

            executor = new Executor({
                prefix,
                ecosystem: {
                    api: 'api',
                    ui: 'ui',
                    store: 'store'
                }
            });

            return executor
                .start({
                    buildId,
                    container,
                    apiUri,
                    token
                })
                .then(() => {
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
            dockerMock.createContainer.withArgs(launcherArgs).yieldsAsync(null, launcherContainer);
            dockerMock.createContainer.withArgs(buildArgs).yieldsAsync(null, buildContainer);

            return executor
                .start({
                    buildId,
                    container,
                    apiUri,
                    token
                })
                .then(() => {
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
            dockerMock.createContainer.withArgs(launcherArgs).yieldsAsync(null, launcherContainer);
            dockerMock.createContainer.withArgs(buildArgs).yieldsAsync(null, buildContainer);

            return executor
                .start({
                    buildId,
                    container,
                    apiUri,
                    token
                })
                .then(() => {
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
            dockerMock.createContainer.withArgs(launcherArgs).yieldsAsync(null, launcherContainer);
            dockerMock.createContainer.withArgs(buildArgs).yieldsAsync(null, buildContainer);

            return executor
                .start({
                    buildId,
                    container,
                    apiUri,
                    token
                })
                .then(() => {
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

            return executor
                .start({
                    buildId,
                    container,
                    apiUri,
                    token
                })
                .then(() => {
                    throw new Error('should not have gotten here');
                })
                .catch(error => {
                    assert.equal(error.message, 'Unable to create container');
                });
        });

        it('bubbles start problems back', () => {
            containerMock.start.yieldsAsync(new Error('Unable to start container'));

            return executor
                .start({
                    buildId,
                    container,
                    apiUri,
                    token
                })
                .then(() => {
                    throw new Error('should not have gotten here');
                })
                .catch(error => {
                    assert.equal(error.message, 'Unable to start container');
                });
        });
    });

    describe('stop', () => {
        const buildId = 1992;
        const apiUri = 'https://api.sd.cd';

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
            dockerMock.listContainers.withArgs(findArgs).yieldsAsync(null, [containerShellMock, containerShellMock]);

            return executor
                .stop({
                    apiUri,
                    buildId
                })
                .then(() => {
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
            dockerMock.listContainers.withArgs(findArgs).yieldsAsync(null, [containerShellMock, containerShellMock]);

            executor = new Executor({
                prefix,
                ecosystem: {
                    api: 'api',
                    ui: 'ui',
                    store: 'store'
                }
            });

            return executor
                .stop({
                    apiUri,
                    buildId
                })
                .then(() => {
                    assert.calledWith(dockerMock.listContainers, findArgs);
                    assert.calledWith(containerMock.remove, removeArgs);
                    assert.callCount(containerMock.remove, 2);
                });
        });

        it('bubbles list problems back', () => {
            dockerMock.listContainers.yieldsAsync(new Error('Unable to list containers'));

            return executor
                .stop({
                    apiUri,
                    buildId
                })
                .then(() => {
                    throw new Error('should not have gotten here');
                })
                .catch(error => {
                    assert.equal(error.message, 'Unable to list containers');
                });
        });

        it('bubbles remove problems back', () => {
            containerMock.remove.yieldsAsync(new Error('Unable to remove container'));

            return executor
                .stop({
                    apiUri,
                    buildId
                })
                .then(() => {
                    throw new Error('should not have gotten here');
                })
                .catch(error => {
                    assert.equal(error.message, 'Unable to remove container');
                });
        });
    });

    describe('stats', () => {
        it('bubbles stats from circuit fuses', () => {
            assert.deepEqual(
                {
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
                },
                executor.stats()
            );
        });
    });

    describe('periodic', () => {
        it('resolves to null when calling periodic start', () =>
            executor.startPeriodic().then(res => assert.isNull(res)));

        it('resolves to null when calling periodic stop', () =>
            executor.stopPeriodic().then(res => assert.isNull(res)));
    });

    describe('frozen', () => {
        it('resolves to null when calling frozen start', () => executor.startFrozen().then(res => assert.isNull(res)));

        it('resolves to null when calling frozen stop', () => executor.stopFrozen().then(res => assert.isNull(res)));
    });
});
