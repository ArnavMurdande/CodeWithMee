'use strict';

const SYSTEM_AUTHOR_ID = '00000000-0000-4000-8000-000000000100';

const CHALLENGES = Object.freeze([
  {
    id: '10000000-0000-4000-8000-000000000101',
    versionId: '20000000-0000-4000-8000-000000000101',
    title: 'Sum Two Numbers',
    difficulty: 'easy',
    score: 10,
    tags: ['arrays', 'fundamentals'],
    statement: 'Read two integers from standard input and print their sum.',
    constraints: 'Each value is between -1,000,000 and 1,000,000.',
    referenceSolution: 'a, b = map(int, input().split())\nprint(a + b)',
    starters: { python: '# Read two integers and print their sum\n', javascript: '// Read two integers and print their sum\n' },
    tests: [['2 3', '5', 'visible'], ['-10 4', '-6', 'hidden'], ['0 0', '0', 'hidden']],
  },
  {
    id: '10000000-0000-4000-8000-000000000102',
    versionId: '20000000-0000-4000-8000-000000000102',
    title: 'Palindrome Check',
    difficulty: 'medium',
    score: 25,
    tags: ['strings', 'two-pointers'],
    statement: 'Read one line and print true when it is a palindrome, otherwise print false.',
    constraints: 'The line contains 1 to 10,000 lowercase ASCII letters.',
    referenceSolution: "s = input().strip()\nprint(str(s == s[::-1]).lower())",
    starters: { python: '# Print true or false\n', javascript: '// Print true or false\n' },
    tests: [['level', 'true', 'visible'], ['code', 'false', 'visible'], ['a', 'true', 'hidden']],
  },
  {
    id: '10000000-0000-4000-8000-000000000103',
    versionId: '20000000-0000-4000-8000-000000000103',
    title: 'Longest Increasing Subsequence Length',
    difficulty: 'hard',
    score: 50,
    tags: ['dynamic-programming', 'binary-search'],
    statement: 'Read n and then n integers. Print the length of their longest strictly increasing subsequence.',
    constraints: '1 <= n <= 100,000; each value fits in a signed 32-bit integer.',
    referenceSolution: 'from bisect import bisect_left\nn=int(input())\na=list(map(int,input().split()))\nd=[]\nfor x in a:\n i=bisect_left(d,x)\n if i==len(d): d.append(x)\n else: d[i]=x\nprint(len(d))',
    starters: { python: '# Print the LIS length\n', javascript: '// Print the LIS length\n' },
    tests: [['8\n10 9 2 5 3 7 101 18', '4', 'visible'], ['5\n5 4 3 2 1', '1', 'hidden'], ['6\n1 2 3 4 5 6', '6', 'hidden']],
  },
]);

async function seedChallenges(client) {
  await client.query(
    `INSERT INTO users (id,email_normalized,email_display,display_name,username,status,platform_role,email_verified_at)
     VALUES ($1,'seed-system@codewithmee.invalid','seed-system@codewithmee.invalid','CodeWithMee','codewithmee','active','learner',NOW())
     ON CONFLICT (id) DO UPDATE SET platform_role='learner', updated_at=NOW()`,
    [SYSTEM_AUTHOR_ID],
  );
  for (const challenge of CHALLENGES) {
    await client.query(
      `INSERT INTO challenges (id,title,difficulty,status,tags,score,created_by_user_id)
       VALUES ($1,$2,$3::challenge_difficulty,'PUBLISHED'::challenge_status,$4::jsonb,$5,$6)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,difficulty=EXCLUDED.difficulty,status=EXCLUDED.status,tags=EXCLUDED.tags,score=EXCLUDED.score,archived_at=NULL,updated_at=NOW()`,
      [challenge.id, challenge.title, challenge.difficulty, JSON.stringify(challenge.tags), challenge.score, SYSTEM_AUTHOR_ID],
    );
    await client.query(
      `INSERT INTO challenge_versions (id,challenge_id,version,statement,constraints_text,reference_solution,starter_templates)
       VALUES ($1,$2,1,$3,$4,$5,$6::jsonb)
       ON CONFLICT (challenge_id,version) DO UPDATE SET statement=EXCLUDED.statement,constraints_text=EXCLUDED.constraints_text,reference_solution=EXCLUDED.reference_solution,starter_templates=EXCLUDED.starter_templates`,
      [challenge.versionId, challenge.id, challenge.statement, challenge.constraints, challenge.referenceSolution, JSON.stringify(challenge.starters)],
    );
    await client.query('DELETE FROM challenge_test_cases WHERE version_id=$1', [challenge.versionId]);
    for (let position = 0; position < challenge.tests.length; position += 1) {
      const [input, output, visibility] = challenge.tests[position];
      await client.query(
        `INSERT INTO challenge_test_cases (version_id,position,input,expected_output,visibility)
         VALUES ($1,$2,$3,$4,$5::challenge_test_visibility)`,
        [challenge.versionId, position, input, output, visibility],
      );
    }
  }
  return { challenges: CHALLENGES.length };
}

module.exports = { CHALLENGES, SYSTEM_AUTHOR_ID, seedChallenges };
