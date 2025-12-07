/**
 * Transaction tests for the bridge service
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testBatchTransaction() {
  console.log('Testing batch transaction (native Prisma)...');

  // Clean up
  await prisma.post.deleteMany({});
  await prisma.user.deleteMany({});

  try {
    // This should succeed - all or nothing
    const [user, post] = await prisma.$transaction([
      prisma.user.create({ data: { name: 'Transaction User' } }),
      prisma.post.create({ data: { title: 'Transaction Post', published: true } }),
    ]);

    console.log('  Created user:', user.name);
    console.log('  Created post:', post.title);
    console.log('  ✅ Batch transaction succeeded');
  } catch (error) {
    console.log('  ❌ Batch transaction failed:', error.message);
  }
}

async function testInteractiveTransaction() {
  console.log('\nTesting interactive transaction (native Prisma)...');

  // Clean up
  await prisma.post.deleteMany({});
  await prisma.user.deleteMany({});

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name: 'Interactive User' } });
      const post = await tx.post.create({
        data: { title: 'Interactive Post', published: true, author_id: user.id }
      });

      // Can do conditional logic
      if (user && post) {
        return { user, post };
      }
      throw new Error('Something went wrong');
    });

    console.log('  Created user:', result.user.name);
    console.log('  Created post:', result.post.title);
    console.log('  ✅ Interactive transaction succeeded');
  } catch (error) {
    console.log('  ❌ Interactive transaction failed:', error.message);
  }
}

async function testTransactionRollback() {
  console.log('\nTesting transaction rollback...');

  // Clean up
  await prisma.post.deleteMany({});
  await prisma.user.deleteMany({});

  const initialCount = await prisma.user.count();
  console.log('  Initial user count:', initialCount);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.create({ data: { name: 'Rollback User' } });

      const midCount = await tx.user.count();
      console.log('  Mid-transaction count:', midCount);

      // Force rollback
      throw new Error('Intentional rollback');
    });
  } catch (error) {
    console.log('  Transaction rolled back:', error.message);
  }

  const finalCount = await prisma.user.count();
  console.log('  Final user count:', finalCount);

  if (finalCount === initialCount) {
    console.log('  ✅ Rollback successful - count unchanged');
  } else {
    console.log('  ❌ Rollback failed - count changed');
  }
}

async function main() {
  console.log('Transaction Tests\n');
  console.log('================\n');

  await prisma.$connect();

  await testBatchTransaction();
  await testInteractiveTransaction();
  await testTransactionRollback();

  await prisma.$disconnect();
  console.log('\n✅ All transaction tests completed');
}

main().catch(async (e) => {
  console.error('Fatal error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
