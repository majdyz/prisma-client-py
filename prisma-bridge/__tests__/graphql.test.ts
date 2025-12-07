/**
 * GraphQL Parser Tests
 */

import { parseGraphQLQuery, selectionsToInclude, Selection } from '../src/parser/graphql';

describe('GraphQL Parser', () => {
  describe('parseGraphQLQuery', () => {
    describe('basic operations', () => {
      it('should parse findUnique query', () => {
        const query = `query {
          result: findUniqueUser(where: { id: "123" }) {
            id
            name
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.operation).toBe('query');
        expect(result!.action).toBe('findUnique');
        expect(result!.model).toBe('User');
        expect(result!.args).toEqual({ where: { id: '123' } });
        expect(result!.selections).toContain('id');
        expect(result!.selections).toContain('name');
      });

      it('should parse findFirst query', () => {
        const query = `query {
          result: findFirstUser(where: { name: { contains: "test" } }) {
            id
            name
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.action).toBe('findFirst');
        expect(result!.model).toBe('User');
        expect(result!.args.where.name.contains).toBe('test');
      });

      it('should parse findMany query with take and skip', () => {
        const query = `query {
          result: findManyUser(where: { name: { contains: "test" } }, take: 10, skip: 5) {
            id
            name
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.action).toBe('findMany');
        expect(result!.args.take).toBe(10);
        expect(result!.args.skip).toBe(5);
      });

      it('should parse findUniqueOrThrow query', () => {
        // Note: prisma-client-py uses findUniqueOrThrowUser format (action+OrThrow+Model)
        const query = `query {
          result: findUniqueOrThrowUser(where: { id: "123" }) {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.action).toBe('findUniqueOrThrow');
        expect(result!.model).toBe('User');
      });
    });

    describe('mutations', () => {
      it('should parse createOne mutation', () => {
        const query = `mutation {
          result: createOneUser(data: { name: "Test User", email: "test@test.com" }) {
            id
            name
            email
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.operation).toBe('mutation');
        expect(result!.action).toBe('create');
        expect(result!.model).toBe('User');
        expect(result!.args.data).toEqual({
          name: 'Test User',
          email: 'test@test.com',
        });
      });

      it('should parse updateOne mutation', () => {
        const query = `mutation {
          result: updateOneUser(where: { id: "123" }, data: { name: "Updated Name" }) {
            id
            name
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.action).toBe('update');
        expect(result!.model).toBe('User');
        expect(result!.args.where).toEqual({ id: '123' });
        expect(result!.args.data).toEqual({ name: 'Updated Name' });
      });

      it('should parse deleteOne mutation', () => {
        const query = `mutation {
          result: deleteOneUser(where: { id: "123" }) {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.action).toBe('delete');
        expect(result!.model).toBe('User');
      });

      it('should parse createMany mutation', () => {
        const query = `mutation {
          result: createManyUser(data: [{ name: "User 1" }, { name: "User 2" }]) {
            count
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.action).toBe('createMany');
        expect(result!.model).toBe('User');
        expect(result!.args.data).toEqual([{ name: 'User 1' }, { name: 'User 2' }]);
      });

      it('should parse updateMany mutation', () => {
        const query = `mutation {
          result: updateManyUser(where: { name: { contains: "Test" } }, data: { name: "Updated" }) {
            count
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.action).toBe('updateMany');
        expect(result!.model).toBe('User');
      });

      it('should parse deleteMany mutation', () => {
        const query = `mutation {
          result: deleteManyUser(where: { name: { contains: "Test" } }) {
            count
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.action).toBe('deleteMany');
        expect(result!.model).toBe('User');
      });

      it('should parse upsert mutation', () => {
        const query = `mutation {
          result: upsertOneUser(
            where: { email: "test@test.com" },
            create: { name: "New User", email: "test@test.com" },
            update: { name: "Updated User" }
          ) {
            id
            name
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.action).toBe('upsert');
        expect(result!.model).toBe('User');
        expect(result!.args.where).toEqual({ email: 'test@test.com' });
        expect(result!.args.create).toEqual({ name: 'New User', email: 'test@test.com' });
        expect(result!.args.update).toEqual({ name: 'Updated User' });
      });
    });

    describe('aggregation', () => {
      it('should parse aggregate query', () => {
        const query = `query {
          result: aggregateUser {
            _count { _all }
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.action).toBe('aggregate');
        expect(result!.model).toBe('User');
      });

      it('should parse groupBy query', () => {
        const query = `query {
          result: groupByUser(by: ["name"]) {
            name
            _count { _all }
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.action).toBe('groupBy');
        expect(result!.model).toBe('User');
        expect(result!.args.by).toEqual(['name']);
      });
    });

    describe('raw queries', () => {
      it('should parse queryRaw', () => {
        const query = `mutation {
          result: queryRaw(query: "SELECT * FROM User", parameters: "[]")
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.action).toBe('queryRaw');
        expect(result!.args.query).toBe('SELECT * FROM User');
      });

      it('should parse executeRaw', () => {
        const query = `mutation {
          result: executeRaw(query: "DELETE FROM User WHERE id = ?", parameters: "[\\"123\\"]")
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.action).toBe('executeRaw');
      });
    });

    describe('complex filters', () => {
      it('should parse contains filter', () => {
        const query = `query {
          result: findManyUser(where: { name: { contains: "test" } }) {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);
        expect(result!.args.where.name.contains).toBe('test');
      });

      it('should parse startsWith filter', () => {
        const query = `query {
          result: findManyUser(where: { name: { startsWith: "test" } }) {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);
        expect(result!.args.where.name.startsWith).toBe('test');
      });

      it('should parse endsWith filter', () => {
        const query = `query {
          result: findManyUser(where: { name: { endsWith: "test" } }) {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);
        expect(result!.args.where.name.endsWith).toBe('test');
      });

      it('should parse in filter', () => {
        const query = `query {
          result: findManyUser(where: { id: { in: ["1", "2", "3"] } }) {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);
        expect(result!.args.where.id.in).toEqual(['1', '2', '3']);
      });

      it('should parse NOT filter', () => {
        const query = `query {
          result: findManyUser(where: { NOT: { name: { contains: "test" } } }) {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);
        expect(result!.args.where.NOT.name.contains).toBe('test');
      });

      it('should parse nested boolean filters', () => {
        const query = `query {
          result: findManyPost(where: { published: true }) {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);
        expect(result!.args.where.published).toBe(true);
      });
    });

    describe('ordering', () => {
      it('should parse orderBy ascending', () => {
        const query = `query {
          result: findManyUser(orderBy: { name: asc }) {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);
        expect(result!.args.orderBy.name).toBe('asc');
      });

      it('should parse orderBy descending', () => {
        const query = `query {
          result: findManyUser(orderBy: { name: desc }) {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);
        expect(result!.args.orderBy.name).toBe('desc');
      });
    });

    describe('relations', () => {
      it('should parse nested selection for relations', () => {
        const query = `query {
          result: findUniqueUser(where: { id: "123" }) {
            id
            name
            posts { id title }
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result).not.toBeNull();
        expect(result!.selections).toContain('id');
        expect(result!.selections).toContain('name');

        const postsSelection = result!.selections.find(
          (s) => typeof s === 'object' && 'posts' in s
        ) as { posts: Selection[] } | undefined;

        expect(postsSelection).toBeDefined();
        expect(postsSelection!.posts).toContain('id');
        expect(postsSelection!.posts).toContain('title');
      });

      it('should parse deeply nested relations', () => {
        const query = `query {
          result: findManyUser {
            id
            posts { id title author { id name } }
          }
        }`;

        const result = parseGraphQLQuery(query);
        const postsSelection = result!.selections.find(
          (s) => typeof s === 'object' && 'posts' in s
        ) as { posts: Selection[] };

        const authorSelection = postsSelection.posts.find(
          (s) => typeof s === 'object' && 'author' in s
        ) as { author: Selection[] };

        expect(authorSelection).toBeDefined();
        expect(authorSelection.author).toContain('id');
        expect(authorSelection.author).toContain('name');
      });

      it('should parse nested create in mutation', () => {
        const query = `mutation {
          result: createOneUser(data: {
            name: "Test User",
            posts: {
              create: [{ title: "Post 1", published: true }]
            }
          }) {
            id
            posts { id title }
          }
        }`;

        const result = parseGraphQLQuery(query);

        expect(result!.args.data.posts.create).toEqual([
          { title: 'Post 1', published: true },
        ]);
      });
    });

    describe('variables and substitution', () => {
      it('should parse query with variable substitution for OR conditions', () => {
        const query = `query {
          result: findManyAgentBlock(where: $where) {
            id
            name
          }
        }`;

        const variables = {
          where: {
            OR: [
              { id: "test" },
              { name: "test" }
            ]
          }
        };

        const result = parseGraphQLQuery(query, variables);

        expect(result).not.toBeNull();
        expect(result!.operation).toBe('query');
        expect(result!.action).toBe('findMany');
        expect(result!.model).toBe('AgentBlock');
        expect(result!.args.where).toEqual({
          OR: [
            { id: "test" },
            { name: "test" }
          ]
        });
      });

      it('should parse query with multiple variables', () => {
        const query = `query {
          result: findManyUser(where: $where, take: $limit, skip: $offset) {
            id
            name
          }
        }`;

        const variables = {
          where: { name: { contains: "test" } },
          limit: 10,
          offset: 0
        };

        const result = parseGraphQLQuery(query, variables);

        expect(result).not.toBeNull();
        expect(result!.args.where).toEqual({ name: { contains: "test" } });
        expect(result!.args.take).toBe(10);
        expect(result!.args.skip).toBe(0);
      });

      it('should handle complex nested variable substitution', () => {
        const query = `query {
          result: findManyPost(where: $filter, orderBy: $sort) {
            id
            title
            author { name }
          }
        }`;

        const variables = {
          filter: {
            AND: [
              { published: true },
              { 
                OR: [
                  { title: { contains: "test" } },
                  { content: { contains: "test" } }
                ]
              }
            ]
          },
          sort: { createdAt: "desc" }
        };

        const result = parseGraphQLQuery(query, variables);

        expect(result).not.toBeNull();
        expect(result!.args.where).toEqual(variables.filter);
        expect(result!.args.orderBy).toEqual(variables.sort);
      });

      it('should handle mixed inline args and variables', () => {
        const query = `query {
          result: findManyUser(where: $where, take: 20) {
            id
          }
        }`;

        const variables = {
          where: { active: true }
        };

        const result = parseGraphQLQuery(query, variables);

        expect(result).not.toBeNull();
        expect(result!.args.where).toEqual({ active: true });
        expect(result!.args.take).toBe(20);
      });
    });

    describe('edge cases', () => {
      it('should handle empty selections', () => {
        const query = `mutation {
          result: deleteManyUser
        }`;

        const result = parseGraphQLQuery(query);
        expect(result).not.toBeNull();
        expect(result!.selections).toEqual([]);
      });

      it('should handle query without args', () => {
        const query = `query {
          result: findManyUser {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);
        expect(result).not.toBeNull();
        expect(result!.args).toEqual({});
      });

      it('should return null for invalid query', () => {
        const query = `invalid query string`;
        const result = parseGraphQLQuery(query);
        expect(result).toBeNull();
      });

      it('should handle escaped strings in arguments', () => {
        const query = `mutation {
          result: createOneUser(data: { name: "Test \\"User\\"" }) {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);
        expect(result!.args.data.name).toBe('Test "User"');
      });

      it('should handle null values', () => {
        const query = `query {
          result: findManyUser(where: { email: null }) {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);
        expect(result!.args.where.email).toBeNull();
      });

      it('should handle numeric values', () => {
        const query = `query {
          result: findManyPost(where: { views: 100 }) {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);
        expect(result!.args.where.views).toBe(100);
      });

      it('should handle float values', () => {
        const query = `query {
          result: findManyProduct(where: { price: 19.99 }) {
            id
          }
        }`;

        const result = parseGraphQLQuery(query);
        expect(result!.args.where.price).toBe(19.99);
      });
    });
  });

  describe('selectionsToInclude', () => {
    it('should return undefined for flat selections', () => {
      const selections: Selection[] = ['id', 'name', 'email'];
      const result = selectionsToInclude(selections);
      expect(result).toBeUndefined();
    });

    it('should convert relation selection to include', () => {
      const selections: Selection[] = ['id', 'name', { posts: ['id', 'title'] }];
      const result = selectionsToInclude(selections);

      expect(result).toEqual({
        posts: true,
      });
    });

    it('should handle nested relations', () => {
      const selections: Selection[] = [
        'id',
        {
          posts: ['id', 'title', { author: ['id', 'name'] }],
        },
      ];
      const result = selectionsToInclude(selections);

      expect(result).toEqual({
        posts: {
          include: {
            author: true,
          },
        },
      });
    });

    it('should handle multiple relations', () => {
      const selections: Selection[] = [
        'id',
        { posts: ['id'] },
        { profile: ['id', 'bio'] },
      ];
      const result = selectionsToInclude(selections);

      expect(result).toEqual({
        posts: true,
        profile: true,
      });
    });
  });
});
