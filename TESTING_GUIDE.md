# Testing Guide

## Overview

This project uses **Jest** with TypeScript support for testing. The test suite includes unit tests and integration tests.

## Test Structure

```
src/tests/
├── orderRepository.test.ts    # Database repository tests
├── redisService.test.ts       # Redis service tests  
├── orderQueue.test.ts         # Order queue tests
├── mockDexRouter.test.ts     # DEX router tests
├── integration.test.ts        # Integration tests (requires DB)
└── setup.ts                   # Test setup configuration
```

## Running Tests

### Basic Commands

```bash
# Run all tests with coverage
npm test

# Run tests in watch mode (auto-reruns on file changes)
npm run test:watch

# Run only unit tests (exclude integration tests)
npx jest --testPathIgnorePatterns=integration.test.ts

# Run specific test file
npx jest orderRepository.test.ts

# Run tests without coverage (faster)
npx jest
```

### Advanced Options

```bash
# Run tests matching a pattern
npx jest --testNamePattern="updateOrder"

# Run tests with verbose output
npx jest --verbose

# Run tests and update snapshots
npx jest --updateSnapshot

# Run tests with coverage for specific file
npx jest --coverage --collectCoverageOnlyFrom=orderRepository.test.ts

# Run tests in debug mode
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Test Configuration

**jest.config.js** settings:
- Uses `ts-jest` preset for TypeScript
- Test files: `src/tests/**/*.test.ts`
- Coverage threshold: 70% (branches, functions, lines, statements)
- Test environment: Node.js
- Setup file: `src/tests/setup.ts`

## Test Categories

### Unit Tests (Fast, No external dependencies)
- `orderRepository.test.ts` - Database operations (mocked)
- `redisService.test.ts` - Redis operations (mocked)
- `orderQueue.test.ts` - Queue management
- `mockDexRouter.test.ts` - DEX routing logic

### Integration Tests (Slower, Requires database)
- `integration.test.ts` - End-to-end workflows

## Writing Tests

### Test Structure
```typescript
describe('ComponentName', () => {
  let component: ComponentName;
  let mockDependency: jest.Mocked<DependencyType>;

  beforeEach(() => {
    // Setup before each test
    mockDependency = createMock();
    component = new ComponentName(mockDependency);
  });

  afterEach(() => {
    // Cleanup after each test
    jest.clearAllMocks();
  });

  describe('methodName', () => {
    it('should do something expected', async () => {
      // Arrange
      const input = createTestData();
      
      // Act
      const result = await component.methodName(input);
      
      // Assert
      expect(result).toEqual(expectedResult);
      expect(mockDependency.method).toHaveBeenCalledWith(input);
    });
  });
});
```

### Mocking Examples

#### Mocking External Libraries
```typescript
jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});
```

#### Mocking Service Methods
```typescript
const mockRedisService = {
  getActiveOrder: jest.fn(),
  setActiveOrder: jest.fn(),
  close: jest.fn(),
} as jest.Mocked<RedisService>;
```

## Common Test Patterns

### Database Repository Tests
```typescript
it('should handle database errors', async () => {
  (mockPool.query as jest.Mock).mockRejectedValue(new Error('DB Error'));
  
  await expect(repository.createOrder(order)).rejects.toThrow('DB Error');
});
```

### Service Tests with Date Handling
```typescript
it('should properly serialize/deserialize dates', async () => {
  const orderWithDates = {
    ...order,
    createdAt: new Date('2025-01-15T10:00:00Z'),
    updatedAt: new Date('2025-01-15T10:05:00Z'),
  };
  
  // Test that dates are properly handled
  const result = await service.getActiveOrder('order-1');
  expect(result.createdAt).toBeInstanceOf(Date);
});
```

### Error Handling Tests
```typescript
it('should return null when not found', async () => {
  (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });
  
  const result = await repository.getOrderById('nonexistent');
  expect(result).toBeNull();
});
```

## Coverage

The project maintains 70% coverage threshold across:
- Branches
- Functions  
- Lines
- Statements

View coverage report:
```bash
npm test
# Coverage report generated in coverage/lcov-report/index.html
```

## Troubleshooting

### Common Issues

1. **Type Errors**: Ensure mock data matches TypeScript interfaces
2. **Date Serialization**: Convert date strings back to Date objects in services
3. **Null vs Undefined**: Database null values should be converted to undefined for optional fields
4. **Integration Tests**: Require PostgreSQL database connection

### Database Setup for Integration Tests

Integration tests require a running PostgreSQL database. Set up environment variables in `.env`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=test_db
DB_USER=test_user
DB_PASSWORD=test_password
REDIS_URL=redis://localhost:6379
```

## Best Practices

1. **Test Naming**: Use descriptive test names that explain what is being tested
2. **AAA Pattern**: Arrange, Act, Assert structure
3. **Mock Management**: Clear mocks in `afterEach` to prevent test pollution
4. **Test Isolation**: Each test should be independent
5. **Edge Cases**: Test error conditions and boundary cases
6. **Date Handling**: Always test date serialization/deserialization
7. **Type Safety**: Ensure mocks match the actual interfaces

## Running Specific Test Scenarios

### Run Failed Tests Only
```bash
npx jest --onlyFailures
```

### Run Tests Changed Since Last Commit
```bash
npx jest --onlyChanged
```

### Run Tests with Specific Pattern
```bash
npx jest --testPathPattern="repository"
```

### Generate Coverage Badge
```bash
npx jest --coverage && coverage-badge-creator
```
