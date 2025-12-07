/**
 * Integration Test for GraphQL Variable Substitution Issue
 * 
 * This test reproduces the exact issue we're having with the AutoGPT project
 * where the bridge receives queries with OR conditions in variables but 
 * fails to parse them correctly.
 */

const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BRIDGE_PORT = 3458;
const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}`;

// Test schema - minimal SQLite setup for isolated testing
const TEST_SCHEMA = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:./test.db"
}

model AgentBlock {
  id   String @id @default(cuid())
  name String
  type String
  
  @@map("AgentBlock")
}

model User {
  id    String @id @default(cuid())
  name  String
  email String @unique
  
  @@map("User")
}
`;

class BridgeTestClient {
  constructor(baseUrl = BRIDGE_URL) {
    this.baseUrl = baseUrl;
  }

  async query(query, variables = {}) {
    try {
      const response = await axios.post(`${this.baseUrl}/`, {
        query,
        variables
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      console.error('Query failed:', error.response?.data || error.message);
      throw error;
    }
  }

  async health() {
    try {
      const response = await axios.get(`${this.baseUrl}/health`);
      return response.data;
    } catch (error) {
      return null;
    }
  }
}

async function setupTestDatabase() {
  console.log('Setting up test database...');
  
  // Write test schema
  fs.writeFileSync('./prisma/schema.prisma', TEST_SCHEMA);
  
  // Generate Prisma client
  const { exec } = require('child_process');
  await new Promise((resolve, reject) => {
    exec('npx prisma generate', (error, stdout, stderr) => {
      if (error) {
        console.error('Prisma generate error:', error);
        reject(error);
        return;
      }
      console.log('Prisma client generated');
      resolve(stdout);
    });
  });

  // Push schema to database
  await new Promise((resolve, reject) => {
    exec('npx prisma db push --force-reset', (error, stdout, stderr) => {
      if (error) {
        console.error('Database setup error:', error);
        reject(error);
        return;
      }
      console.log('Database schema pushed');
      resolve(stdout);
    });
  });
}

async function startBridge() {
  console.log('Starting bridge server...');
  
  return new Promise((resolve, reject) => {
    const bridge = spawn('npm', ['start'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PRISMA_BRIDGE_PORT: BRIDGE_PORT.toString(),
        RATE_LIMIT_ENABLED: 'false',
        PRISMA_SCHEMA_PATH: path.resolve('./prisma/schema.prisma')
      }
    });

    let output = '';
    bridge.stdout.on('data', (data) => {
      const line = data.toString();
      output += line;
      console.log(`Bridge: ${line.trim()}`);
      
      if (line.includes('Prisma Bridge Service running on port')) {
        resolve(bridge);
      }
    });

    bridge.stderr.on('data', (data) => {
      const line = data.toString();
      console.error(`Bridge Error: ${line.trim()}`);
    });

    bridge.on('close', (code) => {
      console.log(`Bridge process exited with code ${code}`);
    });

    // Timeout if server doesn't start
    setTimeout(() => {
      reject(new Error('Bridge server failed to start within 30 seconds'));
    }, 30000);
  });
}

async function waitForBridge(client, maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    const health = await client.health();
    if (health) {
      console.log('Bridge is healthy!');
      return true;
    }
    console.log(`Waiting for bridge... (${i + 1}/${maxRetries})`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Bridge failed to become healthy');
}

async function runTests(client) {
  console.log('Running integration tests...');
  
  const tests = [
    {
      name: 'Test simple OR condition variable substitution',
      query: `query {
        result: findManyAgentBlock(where: $where) {
          id
          name
        }
      }`,
      variables: {
        where: {
          OR: [
            { id: "test-id" },
            { name: "test-name" }
          ]
        }
      },
      expect: (result) => {
        console.log('Query result:', JSON.stringify(result, null, 2));
        return result.data && result.data.result !== undefined;
      }
    },
    
    {
      name: 'Test complex nested variable substitution',
      query: `query {
        result: findManyAgentBlock(where: $filter, take: $limit) {
          id
          name
          type
        }
      }`,
      variables: {
        filter: {
          AND: [
            { type: "action" },
            {
              OR: [
                { name: { contains: "test" } },
                { id: { in: ["1", "2", "3"] } }
              ]
            }
          ]
        },
        limit: 10
      },
      expect: (result) => {
        console.log('Complex query result:', JSON.stringify(result, null, 2));
        return result.data && result.data.result !== undefined;
      }
    },

    {
      name: 'Test mixed variables and inline args',
      query: `query {
        result: findManyUser(where: $where, take: 5) {
          id
          name
        }
      }`,
      variables: {
        where: {
          OR: [
            { name: { startsWith: "A" } },
            { email: { endsWith: "@test.com" } }
          ]
        }
      },
      expect: (result) => {
        console.log('Mixed args result:', JSON.stringify(result, null, 2));
        return result.data && result.data.result !== undefined;
      }
    }
  ];

  const results = [];
  
  for (const test of tests) {
    try {
      console.log(`\n=== Running: ${test.name} ===`);
      console.log('Query:', test.query.trim());
      console.log('Variables:', JSON.stringify(test.variables, null, 2));
      
      const result = await client.query(test.query, test.variables);
      const passed = test.expect(result);
      
      results.push({
        name: test.name,
        passed,
        result,
        error: null
      });
      
      console.log(`✅ ${test.name} - PASSED`);
    } catch (error) {
      results.push({
        name: test.name,
        passed: false,
        result: null,
        error: error.response?.data || error.message
      });
      
      console.log(`❌ ${test.name} - FAILED`);
      console.error('Error:', error.response?.data || error.message);
    }
  }
  
  return results;
}

async function main() {
  let bridge = null;
  
  try {
    console.log('🚀 Starting GraphQL Variable Substitution Integration Test');
    
    // Setup test environment
    await setupTestDatabase();
    
    // Start bridge server
    bridge = await startBridge();
    
    // Wait for bridge to be ready
    const client = new BridgeTestClient();
    await waitForBridge(client);
    
    // Run tests
    const results = await runTests(client);
    
    // Print summary
    console.log('\n' + '='.repeat(50));
    console.log('TEST SUMMARY');
    console.log('='.repeat(50));
    
    let passed = 0;
    let failed = 0;
    
    for (const result of results) {
      if (result.passed) {
        console.log(`✅ ${result.name}`);
        passed++;
      } else {
        console.log(`❌ ${result.name}`);
        if (result.error) {
          console.log(`   Error: ${JSON.stringify(result.error, null, 2)}`);
        }
        failed++;
      }
    }
    
    console.log(`\nTotal: ${results.length}, Passed: ${passed}, Failed: ${failed}`);
    
    if (failed === 0) {
      console.log('🎉 All tests passed!');
      process.exit(0);
    } else {
      console.log('💥 Some tests failed!');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Integration test failed:', error.message);
    process.exit(1);
  } finally {
    if (bridge) {
      console.log('Shutting down bridge server...');
      bridge.kill('SIGTERM');
    }
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { BridgeTestClient, runTests };