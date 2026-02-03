import container from "../src/factory/serviceContainer";
import {TYPES} from "../src/types/common";
import ISwapRateService from "../src/service/swap/ISwapRateService";
import {assert, expect} from "chai";
import {PriceServiceUnavailableError} from "../src/utils/error";

const addPublishTime = (priceData: any) => {
    const nowUnix = Math.floor(Date.now() / 1000);
    return { ...priceData, publishTime: nowUnix - 10 };
};

const successTestData = [
    {
        name: "Basic 2:1 ratio",
        solPriceData: {
            price: 200000000,
            exponent: -8,
            confidence: 400000
        },
        twozPriceData: {
            price: 100000000,
            exponent: -8,
            confidence: 500000
        },
        expectedSwapRate: 2
    },
    {
        name: "Fractional ratio",
        solPriceData: {
            price: 250000000,
            exponent: -8,
            confidence: 100000
        },
        twozPriceData: {
            price: 150000000,
            exponent: -8,
            confidence: 300000
        },
        expectedSwapRate: 1.666667 // Rounded to 6 decimal places
    },
    {
        name: "Less than 1 ratio",
        solPriceData: {
            price: 300000000,
            exponent: -8,
            confidence: 350000
        },
        twozPriceData: {
            price: 550000000,
            exponent: -8,
            confidence: 444000
        },
        expectedSwapRate: 0.545455 // Rounded to 6 decimal places
    },
    {
        name: "Very small values with negative exponents",
        solPriceData: {
            price: 15000000000, // $150 with exponent -8
            exponent: -8,
            confidence: 500000 // $0.005
        },
        twozPriceData: {
            price: 100000000, // $1 with exponent -8
            exponent: -8,
            confidence: 200000 // $0.002
        },
        expectedSwapRate: 150
    },
    {
        name: "Equal prices should give 1:1 ratio",
        solPriceData: {
            price: 100000000,
            exponent: -8,
            confidence: 100000
        },
        twozPriceData: {
            price: 100000000,
            exponent: -8,
            confidence: 100000
        },
        expectedSwapRate: 1
    },
    {
        name: "High precision decimal result",
        solPriceData: {
            price: 123456700,
            exponent: -8,
            confidence: 100000
        },
        twozPriceData: {
            price: 987654300,
            exponent: -8,
            confidence: 200000
        },
        expectedSwapRate: 0.125000 // 1.234567 / 9.876543 ≈ 0.125
    },
    {
        name: "Scenario: Baseline ($200 SOL / $1 2Z)",
        solPriceData: {
            price: 20000000000,    // $200 with exponent -8
            exponent: -8,
            confidence: 10000000   // $0.10 (0.05% ratio)
        },
        twozPriceData: {
            price: 100000000,      // $1 with exponent -8
            exponent: -8,
            confidence: 100000     // $0.001 (0.1% ratio)
        },
        expectedSwapRate: 200
    },
    {
        name: "Scenario: SOL up ($500 SOL / $1 2Z)",
        solPriceData: {
            price: 50000000000,    // $500 with exponent -8
            exponent: -8,
            confidence: 25000000   // $0.25 (0.05% ratio)
        },
        twozPriceData: {
            price: 100000000,      // $1 with exponent -8
            exponent: -8,
            confidence: 100000     // $0.001 (0.1% ratio)
        },
        expectedSwapRate: 500
    },
    {
        name: "Scenario: SOL down ($50 SOL / $1 2Z)",
        solPriceData: {
            price: 5000000000,     // $50 with exponent -8
            exponent: -8,
            confidence: 2500000    // $0.025 (0.05% ratio)
        },
        twozPriceData: {
            price: 100000000,      // $1 with exponent -8
            exponent: -8,
            confidence: 100000     // $0.001 (0.1% ratio)
        },
        expectedSwapRate: 50
    },
    {
        name: "Scenario: 2Z up ($200 SOL / $2 2Z)",
        solPriceData: {
            price: 20000000000,    // $200 with exponent -8
            exponent: -8,
            confidence: 10000000   // $0.10 (0.05% ratio)
        },
        twozPriceData: {
            price: 200000000,      // $2 with exponent -8
            exponent: -8,
            confidence: 200000     // $0.002 (0.1% ratio)
        },
        expectedSwapRate: 100
    },
    {
        name: "Scenario: 2Z down ($200 SOL / $0.50 2Z)",
        solPriceData: {
            price: 20000000000,    // $200 with exponent -8
            exponent: -8,
            confidence: 10000000   // $0.10 (0.05% ratio)
        },
        twozPriceData: {
            price: 50000000,       // $0.50 with exponent -8
            exponent: -8,
            confidence: 50000      // $0.0005 (0.1% ratio)
        },
        expectedSwapRate: 400
    },
    {
        name: "Scenario: Fractional ($150 SOL / $1.10 2Z)",
        solPriceData: {
            price: 15000000000,    // $150 with exponent -8
            exponent: -8,
            confidence: 7500000    // $0.075 (0.05% ratio)
        },
        twozPriceData: {
            price: 110000000,      // $1.10 with exponent -8
            exponent: -8,
            confidence: 110000     // $0.0011 (0.1% ratio)
        },
        expectedSwapRate: 136.363636 // 150 / 1.10 ≈ 136.363636
    }
];

const confidenceFailureTestData = [
    {
        name: "SOL confidence too high",
        solPriceData: {
            price: 100000000, // $1 with exponent -8
            exponent: -8,
            confidence: 800000 // $0.008 = 0.8% confidence ratio
        },
        twozPriceData: {
            price: 100000000, // $1 with exponent -8
            exponent: -8,
            confidence: 100000 // $0.001 = 0.1% confidence ratio
        },
        shouldPass: false
    },
    {
        name: "TWOZ confidence too high",
        solPriceData: {
            price: 100000000, // $1 with exponent -8
            exponent: -8,
            confidence: 100000 // $0.001 = 0.1% confidence ratio
        },
        twozPriceData: {
            price: 100000000, // $1 with exponent -8
            exponent: -8,
            confidence: 800000 // $0.008 = 0.8% confidence ratio
        },
        shouldPass: false
    },
    {
        name: "Both confidences too high",
        solPriceData: {
            price: 100000000, // $1 with exponent -8
            exponent: -8,
            confidence: 500000 // $0.005 = 0.5% confidence ratio
        },
        twozPriceData: {
            price: 100000000, // $1 with exponent -8
            exponent: -8,
            confidence: 500000 // $0.005 = 0.5% confidence ratio
        },
        shouldPass: false
    },
    {
        name: "Edge case: exactly at threshold (should pass)",
        solPriceData: {
            price: 100000000, // $1 with exponent -8
            exponent: -8,
            confidence: 350000 // $0.0035 = 0.35% confidence ratio
        },
        twozPriceData: {
            price: 100000000, // $1 with exponent -8
            exponent: -8,
            confidence: 350000 // $0.0035 = 0.35% confidence ratio
        },
        shouldPass: true,
        expectedSwapRate: 1
    },
    {
        name: "Just over threshold (should fail)",
        solPriceData: {
            price: 100000000, // $1 with exponent -8
            exponent: -8,
            confidence: 350100 // $0.003501 = 0.3501% confidence ratio
        },
        twozPriceData: {
            price: 100000000, // $1 with exponent -8
            exponent: -8,
            confidence: 350100 // $0.003501 = 0.3501% confidence ratio
        },
        shouldPass: false
    }
];

const edgeCaseTestData = [
    {
        name: "Zero confidence values",
        solPriceData: {
            price: 100000000,     // $1.00 with exponent -8
            exponent: -8,
            confidence: 0
        },
        twozPriceData: {
            price: 50000000,       // $0.50 with exponent -8
            exponent: -8,
            confidence: 0
        },
        expectedSwapRate: 2
    },
    {
        name: "Very small prices with high exponents",
        solPriceData: {
            price: 1, // 1 * 10^-12 = very small number
            exponent: -12,
            confidence: 0
        },
        twozPriceData: {
            price: 1, // 1 * 10^-12 = very small number
            exponent: -12,
            confidence: 0
        },
        expectedSwapRate: 1
    },
    {
        name: "String price inputs",
        solPriceData: {
            price: "200000000",    // $2.00 with exponent -8
            exponent: -8,
            confidence: "100000"   // $0.001
        },
        twozPriceData: {
            price: "100000000",    // $1.00 with exponent -8
            exponent: -8,
            confidence: "50000"    // $0.0005
        },
        expectedSwapRate: 2
    }
];

describe('SwapRateService', () => {
    let swapRateService: ISwapRateService;

    beforeEach(() => {
        swapRateService = container.get<ISwapRateService>(TYPES.SwapRateService);
    });

    describe('Successful swap rate calculations', () => {
        successTestData.forEach((testData) => {
            it(`should calculate correct swap rate: ${testData.name}`, async () => {
                const result = await swapRateService.swapRateCalculation(
                    addPublishTime(testData.solPriceData),
                    addPublishTime(testData.twozPriceData)
                );

                console.log(`Test: ${testData.name}`);
                console.log(`Calculated swapRate: ${result.swapRate}`);
                console.log(`Expected swapRate: ${testData.expectedSwapRate}`);

                expect(result.swapRate).to.be.approximately(testData.expectedSwapRate, 0.000001);
                expect(result.solPriceUsd).to.be.a('number');
                expect(result.twozPriceUsd).to.be.a('number');
                expect(result.last_price_update).to.be.a('string');
            });
        });
    });

    describe('Confidence threshold validation', () => {
        confidenceFailureTestData.forEach((testData) => {
            if (testData.shouldPass) {
                it(`should pass confidence check: ${testData.name}`, async () => {
                    const result = await swapRateService.swapRateCalculation(
                    addPublishTime(testData.solPriceData),
                    addPublishTime(testData.twozPriceData)
                );
                expect(result.swapRate).to.be.approximately(testData.expectedSwapRate!, 0.000001);
            });
        } else {
            it(`should fail confidence check: ${testData.name}`, async () => {
                try {
                    const result = await swapRateService.swapRateCalculation(
                        addPublishTime(testData.solPriceData),
                        addPublishTime(testData.twozPriceData)
                    );
                    console.log(result)
                    console.log(`Test: ${testData.name}`);
                    assert.fail('Expected PriceServiceUnavailableError to be thrown');
                } catch (error) {
                    expect(error).to.be.instanceOf(PriceServiceUnavailableError);
                }
            });
        }
    });
});

    describe('Edge cases and data type handling', () => {
        edgeCaseTestData.forEach((testData) => {
        it(`should handle edge case: ${testData.name}`, async () => {
            const result = await swapRateService.swapRateCalculation(
                addPublishTime(testData.solPriceData),
                addPublishTime(testData.twozPriceData)
            );

            expect(result.swapRate).to.be.approximately(testData.expectedSwapRate, 0.000001);
            expect(result.solPriceUsd).to.be.a('number');
            expect(result.twozPriceUsd).to.be.a('number');
        });
    });
    });

    describe('Price conversion validation', () => {
        it('should correctly convert prices with different exponents', async () => {
            const testCases = [
                {
                    price: 123456,
                    exponent: -6,
                    expected: 0.123456
                },
                {
                    price: 123456,
                    exponent: -8,
                    expected: 0.00123456
                },
                {
                    price: 123,
                    exponent: 2,
                    expected: 12300
                },
                {
                    price: "789",
                    exponent: -3,
                    expected: 0.789
                }
            ];

            testCases.forEach((testCase) => {
                const converted = swapRateService.convertPrice(testCase.price, testCase.exponent);
                expect(converted).to.be.approximately(testCase.expected, 0.0000001);
            });
        });
    });

    describe('Confidence ratio calculations', () => {
        it('should calculate confidence ratios correctly', async () => {
            const solPriceData = {
                price: 100000000,      // $1 with exponent -8
                exponent: -8,
                confidence: 700000     // $0.007 = 0.7% confidence ratio
            };
            const twozPriceData = {
                price: 100000000,      // $1 with exponent -8
                exponent: -8,
                confidence: 0
            };

            const result = await swapRateService.swapRateCalculation(
                addPublishTime(solPriceData),
                addPublishTime(twozPriceData)
            );
            expect(result.swapRate).to.equal(1);
        });

        it('should reject when combined confidence ratio exceeds 0.7%', async () => {
            const solPriceData = {
                price: 100000000,      // $1 with exponent -8
                exponent: -8,
                confidence: 400000     // $0.004 = 0.4% confidence ratio
            };
            const twozPriceData = {
                price: 100000000,      // $1 with exponent -8
                exponent: -8,
                confidence: 400000     // $0.004 = 0.4% confidence ratio
            };

            try {
                await swapRateService.swapRateCalculation(
                    addPublishTime(solPriceData),
                    addPublishTime(twozPriceData)
                );
                assert.fail('Expected PriceServiceUnavailableError to be thrown');
            } catch (error) {
                expect(error).to.be.instanceOf(PriceServiceUnavailableError);
            }
        });
    });

    describe('Return value structure validation', () => {
        it('should return properly structured PriceRate object', async () => {
            const solPriceData = {
                price: 150000000,      // $1.50 with exponent -8
                exponent: -8,
                confidence: 100000     // $0.001
            };
            const twozPriceData = {
                price: 100000000,      // $1.00 with exponent -8
                exponent: -8,
                confidence: 50000      // $0.0005
            };

            const result = await swapRateService.swapRateCalculation(
                addPublishTime(solPriceData),
                addPublishTime(twozPriceData)
            );

            expect(result).to.have.property('swapRate');
            expect(result).to.have.property('solPriceUsd');
            expect(result).to.have.property('twozPriceUsd');
            expect(result).to.have.property('last_price_update');
            expect(result).to.have.property('publishTime');
            expect(result).to.have.property('solPublishTime');
            expect(result).to.have.property('twozPublishTime');
            expect(result.swapRate).to.be.a('number');
            expect(result.solPriceUsd).to.be.a('number');
            expect(result.twozPriceUsd).to.be.a('number');
            expect(result.last_price_update).to.be.a('string');
            expect(result.publishTime).to.be.a('number');
            expect(result.solPriceUsd).to.equal(1.5);
            expect(result.twozPriceUsd).to.equal(1.0);
            expect(result.swapRate).to.equal(1.5);
            expect(() => new Date(result.last_price_update)).to.not.throw();
        });
    });
});