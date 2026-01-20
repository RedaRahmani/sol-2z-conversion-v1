import { assert } from "chai";
import { HealthMonitoringService } from "../src/service/monitor/healthMonitoringService";
import { CircuitBreakerService } from "../src/service/monitor/circuitBreakerService";
import { IPricingService } from "../src/service/pricing/IPricingService";
import { CircuitBreakerState, HealthCheckResult, HealthStatus, PriceRate, PricingServicesConfig } from "../src/types/common";


class MockPricingService implements IPricingService {
    private healthResult: HealthCheckResult | null = null;
    private shouldThrow: boolean = false;
    private throwError: Error | null = null;
    private serviceType: string;

    constructor(serviceType: string = 'MockService') {
        this.serviceType = serviceType;
    }

    init(): void {}

    getPricingServiceType(): string {
        return this.serviceType;
    }

    async fetchPrice(feedID: string): Promise<any> {
        return {};
    }

    async swapRateCal(solPriceData: any, twozPriceData: any): Promise<any> {
        return {};
    }

    async retrieveSwapRate(): Promise<PriceRate> {
        return {
            swapRate: 1,
            solPriceUsd: 100,
            twozPriceUsd: 100,
            last_price_update: new Date().toISOString()
        };
    }

    async getHealth(): Promise<HealthCheckResult> {
        if (this.shouldThrow) {
            throw this.throwError || new Error('Mock health check error');
        }
        if (this.healthResult) {
            return this.healthResult;
        }
        return {
            serviceType: this.serviceType,
            status: HealthStatus.HEALTHY,
            hermes_connected: true,
            cache_connected: true,
            last_price_update: new Date().toISOString()
        };
    }

    setHealthResult(result: HealthCheckResult): void {
        this.healthResult = result;
    }

    setThrowOnHealthCheck(shouldThrow: boolean, error?: Error): void {
        this.shouldThrow = shouldThrow;
        this.throwError = error || null;
    }
}

class MockPricingServiceFactory {
    private services: IPricingService[];

    constructor(services: IPricingService[]) {
        this.services = services;
    }

    create(): IPricingService[] {
        return this.services;
    }
}


describe('HealthMonitoringService - getHealth exception handling', () => {

    let circuitBreakerService: CircuitBreakerService;
    let healthMonitoringService: HealthMonitoringService;

    beforeEach(() => {
        circuitBreakerService = new CircuitBreakerService();
    });

    it('should not crash when a single service getHealth throws', async () => {
        const healthyService = new MockPricingService('HealthyService');
        const throwingService = new MockPricingService('ThrowingService');
        throwingService.setThrowOnHealthCheck(true, new Error('Connection refused'));

        const factory = new MockPricingServiceFactory([healthyService, throwingService]);
        
        healthMonitoringService = new HealthMonitoringService(
            factory as any,
            circuitBreakerService
        );

        await healthMonitoringService.startMonitoring();

        const monitoringData = await healthMonitoringService.getHealthMonitoringData();
        
        assert.lengthOf(monitoringData, 2, 'Should have health data for both services');
        
        const throwingResult = monitoringData.find(r => r.serviceType === 'ThrowingService');
        assert.isDefined(throwingResult, 'Should have result for throwing service');
        assert.strictEqual(throwingResult!.status, HealthStatus.UN_HEALTHY, 'Throwing service should be marked unhealthy');
        assert.isFalse(throwingResult!.hermes_connected, 'hermes_connected should be false for thrown exception');
        assert.isFalse(throwingResult!.cache_connected, 'cache_connected should be false for thrown exception');

        const healthyResult = monitoringData.find(r => r.serviceType === 'HealthyService');
        assert.isDefined(healthyResult, 'Should have result for healthy service');
        assert.strictEqual(healthyResult!.status, HealthStatus.HEALTHY, 'Healthy service should remain healthy');
    });

    it('should not crash when all services getHealth throw', async () => {
        const throwingService1 = new MockPricingService('ThrowingService1');
        throwingService1.setThrowOnHealthCheck(true, new Error('Network error'));
        
        const throwingService2 = new MockPricingService('ThrowingService2');
        throwingService2.setThrowOnHealthCheck(true, new Error('Timeout'));

        const factory = new MockPricingServiceFactory([throwingService1, throwingService2]);
        
        healthMonitoringService = new HealthMonitoringService(
            factory as any,
            circuitBreakerService
        );

        // Should NOT throw
        await healthMonitoringService.startMonitoring();

        const monitoringData = await healthMonitoringService.getHealthMonitoringData();
        
        assert.lengthOf(monitoringData, 2, 'Should have health data for both services');
        
        // Both should be unhealthy
        for (const result of monitoringData) {
            assert.strictEqual(result.status, HealthStatus.UN_HEALTHY, `${result.serviceType} should be unhealthy`);
        }
    });

    it('should continue monitoring loop after exception (simulated multiple iterations)', async () => {
        const flakyService = new MockPricingService('FlakyService');
        
        const factory = new MockPricingServiceFactory([flakyService]);
        
        healthMonitoringService = new HealthMonitoringService(
            factory as any,
            circuitBreakerService
        );

        flakyService.setThrowOnHealthCheck(false);
        await healthMonitoringService.startMonitoring();
        let data = await healthMonitoringService.getHealthMonitoringData();
        assert.strictEqual(data[0].status, HealthStatus.HEALTHY);

        flakyService.setThrowOnHealthCheck(true, new Error('Temporary failure'));
        await healthMonitoringService.startMonitoring();
        data = await healthMonitoringService.getHealthMonitoringData();
        assert.strictEqual(data[0].status, HealthStatus.UN_HEALTHY);

        flakyService.setThrowOnHealthCheck(false);
        await healthMonitoringService.startMonitoring();
        data = await healthMonitoringService.getHealthMonitoringData();
        assert.strictEqual(data[0].status, HealthStatus.HEALTHY);
    });

    it('should handle non-Error throws gracefully', async () => {
        const throwingService = new MockPricingService('StringThrower');
        throwingService.getHealth = async () => {
            throw 'String error message';
        };

        const factory = new MockPricingServiceFactory([throwingService]);
        
        healthMonitoringService = new HealthMonitoringService(
            factory as any,
            circuitBreakerService
        );

        // Should NOT throw
        await healthMonitoringService.startMonitoring();

        const monitoringData = await healthMonitoringService.getHealthMonitoringData();
        assert.strictEqual(monitoringData[0].status, HealthStatus.UN_HEALTHY);
    });

    it('should not crash when getPricingServiceType throws', async () => {
        const brokenService = new MockPricingService('BrokenService');
        brokenService.getPricingServiceType = () => {
            throw new Error('getPricingServiceType exploded');
        };
        brokenService.setThrowOnHealthCheck(true, new Error('getHealth also fails'));

        const factory = new MockPricingServiceFactory([brokenService]);
        
        healthMonitoringService = new HealthMonitoringService(
            factory as any,
            circuitBreakerService
        );

        await healthMonitoringService.startMonitoring();

        const monitoringData = await healthMonitoringService.getHealthMonitoringData();
        assert.lengthOf(monitoringData, 1);
        assert.strictEqual(monitoringData[0].status, HealthStatus.UN_HEALTHY);
        assert.strictEqual(monitoringData[0].serviceType, 'UnknownService');
    });

    it('should recover circuit breaker after consecutive successful health checks', async () => {
        const flakyService = new MockPricingService('FlakyService');
        
        const factory = new MockPricingServiceFactory([flakyService]);
        
        healthMonitoringService = new HealthMonitoringService(
            factory as any,
            circuitBreakerService
        );

        flakyService.setThrowOnHealthCheck(true, new Error('Initial failure'));
        await healthMonitoringService.startMonitoring();
        assert.strictEqual(circuitBreakerService.getStats().state, CircuitBreakerState.OPEN);
        assert.isFalse(circuitBreakerService.canExecute());

        flakyService.setThrowOnHealthCheck(false);
        await healthMonitoringService.startMonitoring(); // 1st success
        assert.strictEqual(circuitBreakerService.getStats().state, CircuitBreakerState.OPEN);
        
        await healthMonitoringService.startMonitoring(); // 2nd success
        assert.strictEqual(circuitBreakerService.getStats().state, CircuitBreakerState.OPEN);
        
        await healthMonitoringService.startMonitoring(); // 3rd success - should close
        assert.strictEqual(circuitBreakerService.getStats().state, CircuitBreakerState.CLOSED);
        assert.isTrue(circuitBreakerService.canExecute());
    });

});
