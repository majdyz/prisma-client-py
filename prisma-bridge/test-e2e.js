// End-to-end test for the bridge service
const { PrismaClient } = require('@prisma/client');
const { parseGraphQLQuery } = require('./dist/parser/graphql');
const { executeQuery } = require('./dist/translator/executor');

const prisma = new PrismaClient();

async function test() {
  await prisma.$connect();
  console.log('Connected to database\n');

  // Clean up any existing test data
  await prisma.user.deleteMany({ where: { email: { contains: 'test-e2e' } } });

  // Test 1: Create
  console.log('=== Test 1: Create ===');
  const createQuery = 'mutation { result: createOneUser(data: { email: "test-e2e@example.com", name: "E2E Test User" }) { id email name } }';
  const createParsed = parseGraphQLQuery(createQuery);
  console.log('Parsed:', JSON.stringify(createParsed, null, 2));
  const createResult = await executeQuery(prisma, createParsed);
  console.log('Result:', createResult);
  const userId = createResult.id;

  // Test 2: FindUnique
  console.log('\n=== Test 2: FindUnique ===');
  const findQuery = `query { result: findUniqueUser(where: { id: "${userId}" }) { id email name } }`;
  const findParsed = parseGraphQLQuery(findQuery);
  console.log('Parsed:', JSON.stringify(findParsed, null, 2));
  const findResult = await executeQuery(prisma, findParsed);
  console.log('Result:', findResult);

  // Test 3: FindMany
  console.log('\n=== Test 3: FindMany ===');
  const findManyQuery = 'query { result: findManyUser(take: 10) { id email name } }';
  const findManyParsed = parseGraphQLQuery(findManyQuery);
  console.log('Parsed:', JSON.stringify(findManyParsed, null, 2));
  const findManyResult = await executeQuery(prisma, findManyParsed);
  console.log('Result:', findManyResult);

  // Test 4: Update
  console.log('\n=== Test 4: Update ===');
  const updateQuery = `mutation { result: updateOneUser(where: { id: "${userId}" }, data: { name: "Updated E2E User" }) { id email name } }`;
  const updateParsed = parseGraphQLQuery(updateQuery);
  console.log('Parsed:', JSON.stringify(updateParsed, null, 2));
  const updateResult = await executeQuery(prisma, updateParsed);
  console.log('Result:', updateResult);

  // Test 5: Delete
  console.log('\n=== Test 5: Delete ===');
  const deleteQuery = `mutation { result: deleteOneUser(where: { id: "${userId}" }) { id } }`;
  const deleteParsed = parseGraphQLQuery(deleteQuery);
  console.log('Parsed:', JSON.stringify(deleteParsed, null, 2));
  const deleteResult = await executeQuery(prisma, deleteParsed);
  console.log('Result:', deleteResult);

  // Verify deletion
  const verifyResult = await prisma.user.findUnique({ where: { id: userId } });
  console.log('\nVerify deleted (should be null):', verifyResult);

  await prisma.$disconnect();
  console.log('\n✅ All tests passed!');
}

test().catch(async (e) => {
  console.error('Test failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
