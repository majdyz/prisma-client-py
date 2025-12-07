const fs = require('fs');
const path = require('path');

/**
 * Script to copy the project's schema.prisma file to the bridge directory.
 * This allows the bridge to use the actual project schema instead of a fixed one.
 */

function findProjectSchema() {
  // Look for schema.prisma in common locations
  const searchPaths = [
    // Environment variable override
    process.env.PRISMA_SCHEMA_PATH,
    // Look in parent directories (when bridge is in package)
    '../../../schema.prisma',
    '../../../../schema.prisma', 
    '../../../../../schema.prisma',
    // Look for common project patterns
    '../backend/schema.prisma',
    '../../backend/schema.prisma',
    '../../../backend/schema.prisma',
    // Current working directory
    process.cwd() + '/schema.prisma',
  ];

  for (const searchPath of searchPaths) {
    if (!searchPath) continue;
    
    const absolutePath = path.resolve(__dirname, '..', searchPath);
    if (fs.existsSync(absolutePath)) {
      console.log(`Found project schema at: ${absolutePath}`);
      return absolutePath;
    }
  }

  return null;
}

function copyProjectSchema() {
  const projectSchemaPath = findProjectSchema();
  const bridgeSchemaPath = path.resolve(__dirname, '..', 'prisma', 'schema.prisma');
  
  if (!projectSchemaPath) {
    console.error('❌ Error: Could not find project schema.prisma file.');
    console.error('The bridge requires a schema.prisma file to generate the Prisma client.');
    console.error('Set PRISMA_SCHEMA_PATH environment variable to specify the schema location.');
    process.exit(1);
  }

  try {
    // Read the project schema
    let schemaContent = fs.readFileSync(projectSchemaPath, 'utf8');
    
    // Replace the generator to use prisma-client-js for the bridge
    schemaContent = schemaContent.replace(
      /generator\s+client\s*{[\s\S]*?}/,
      `generator client {
  provider = "prisma-client-js"
}`
    );
    
    console.log('Copying project schema to bridge...');
    console.log(`Source: ${projectSchemaPath}`);
    console.log(`Target: ${bridgeSchemaPath}`);
    
    // Write to bridge schema location
    fs.writeFileSync(bridgeSchemaPath, schemaContent);
    
    console.log('✅ Successfully copied project schema to bridge');
  } catch (error) {
    console.error('❌ Failed to copy project schema:', error.message);
    process.exit(1);
  }
}

// Run the script
copyProjectSchema();