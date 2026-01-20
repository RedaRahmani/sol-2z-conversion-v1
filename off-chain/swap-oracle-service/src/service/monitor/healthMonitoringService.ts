import {IPricingService} from "../pricing/IPricingService";
import {HealthCheckResult, HealthStatus, TYPES} from "../../types/common";
import {PricingServiceFactory} from "../../factory/serviceFactory";
import { injectable, inject } from 'inversify';
import {CircuitBreakerService} from "./circuitBreakerService";
import {logger} from "../../utils/logger";


@injectable()
export class HealthMonitoringService {
    private pricingServices: IPricingService[]
    private monitoringData: HealthCheckResult[] = []
    private lastWarnAtMs: Map<string, number> = new Map()
    private readonly warnThrottleMs: number = 60_000

    constructor(
        @inject(TYPES.PricingServiceFactory) private pricingServiceFactory: PricingServiceFactory,
        @inject(TYPES.CircuitBreakerService) private circuitBreakerService: CircuitBreakerService
    ) {
        this.initializePricingServices();
    }

    private initializePricingServices(): void {
        try {
            this.pricingServices = this.pricingServiceFactory.create();
            this.pricingServices.forEach(priceService => {
                priceService.init();
            });
            logger.info(`Initialized ${this.pricingServices.length} pricing services for health monitoring`);
        } catch (error) {
            logger.error('Failed to initialize pricing services for health monitoring:', error);
            this.pricingServices = [];
        }
    }


    async startMonitoring(): Promise<void> {
        const pricePromises = this.pricingServices.map(async (priceService) => {
            try {
                return await priceService.getHealth();
            } catch (error) {
                let serviceName = 'UnknownService';
                try {
                serviceName = priceService.getPricingServiceType();
                } catch {
                // ignore
                }

                this.logWarnThrottled(serviceName, error);
                return {
                serviceType: serviceName,
                status: HealthStatus.UN_HEALTHY,
                hermes_connected: false,
                cache_connected: false,
                last_price_update: '',
                } as HealthCheckResult;
            }
        });

        logger.debug("Price data requested")
        this.monitoringData = await Promise.all(pricePromises);
        logger.debug("Monitoring Data:", this.monitoringData)
        const hasUnhealthy = this.monitoringData.some(healthCheck =>
            healthCheck.status === HealthStatus.UN_HEALTHY);

        if (hasUnhealthy) {
            this.circuitBreakerService.reportHealthCheckFailure();
        } else {
            this.circuitBreakerService.reportHealthCheckSuccess();
        }

    }

    private logWarnThrottled(serviceName: string, error: unknown): void {
        const now = Date.now();
        const lastWarn = this.lastWarnAtMs.get(serviceName) ?? 0;
        if (now - lastWarn >= this.warnThrottleMs) {
            this.lastWarnAtMs.set(serviceName, now);
            logger.warn(`Health check failed for service ${serviceName}`, {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
        }
    }

    async getHealthMonitoringData(): Promise<HealthCheckResult[]> {
        return this.monitoringData;
    }

    async getHealthStatus(): Promise<boolean> {
        logger.debug("Monitoring Data:",this.monitoringData)
        if(!this.circuitBreakerService.canExecute()){
            logger.info('Circuit breaker is open, health status is false');
            return false;
        }
        return  this.monitoringData.some(healthCheck => healthCheck.status === HealthStatus.HEALTHY);
    }
}