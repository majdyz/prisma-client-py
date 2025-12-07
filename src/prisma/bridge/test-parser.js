// Simple test for the GraphQL parser
const { parseGraphQLQuery } = require('./dist/parser/graphql');

const testQueries = [
  // Create
  'mutation { result: createOneUser(data: { email: "test@example.com", name: "Test User" }) { id email name } }',
  // FindUnique
  'query { result: findUniqueUser(where: { id: "123" }) { id email name } }',
  // FindMany
  'query { result: findManyUser(take: 10, where: { name: { contains: "test" } }) { id email name } }',
  // Update
  'mutation { result: updateOneUser(where: { id: "123" }, data: { name: "Updated Name" }) { id email name } }',
  // Delete
  'mutation { result: deleteOneUser(where: { id: "123" }) { id } }',
];

console.log('Testing GraphQL Parser\n');

for (const query of testQueries) {
  console.log('Input:', query.substring(0, 80) + '...');
  const parsed = parseGraphQLQuery(query);
  if (parsed) {
    console.log('Parsed:', JSON.stringify({
      action: parsed.action,
      model: parsed.model,
      args: parsed.args,
    }, null, 2));
  } else {
    console.log('FAILED to parse!');
  }
  console.log('---');
}
