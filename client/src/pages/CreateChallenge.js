import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../lib/api';
import Editor from '../components/CodeEditor';
import AppDropdown from '../components/AppDropdown';

const BinIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M7 6V3C7 2.44772 7.44772 2 8 2H16C16.5523 2 17 2.44772 17 3V6H22V8H2V6H7ZM6 8H18V21C18 21.5523 17.5523 22 17 22H7C6.44772 22 6 21.5523 6 21V8ZM9 10V19H11V10H9ZM13 10V19H15V10H13Z"></path>
  </svg>
);

const CustomDropdown = ({ label, options, selected, onSelect }) => {
  const selectedOption = options.find(
    (option) => option.value === selected || option.label === selected,
  );

  return (
    <div className="form-group custom-dropdown">
      <p className="form-label">{label}</p>
      <AppDropdown
        label={label}
        onChange={(value) => onSelect(options.find((option) => option.value === value))}
        options={options}
        value={selectedOption?.value}
      />
    </div>
  );
};

const CreateChallenge = () => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    constraints: '',
    difficulty: 'Easy',
    score: 5,
    tags: '',
    solutionLanguage: 'python',
    solution: '# Your solution code here\ndef solve():\n  return True',
  });
  const [testCases, setTestCases] = useState([{ input: '', output: '', isExample: true }]);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const { title, description, constraints, difficulty, score, tags, solution, solutionLanguage } =
    formData;

  const difficultyOptions = [
    { value: 'Easy', label: 'Easy' },
    { value: 'Medium', label: 'Medium' },
    { value: 'Hard', label: 'Hard' },
  ];

  const languageOptions = [
    { value: 'python', label: 'Python' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'java', label: 'Java' },
    { value: 'cpp', label: 'C++' },
    { value: 'c', label: 'C' },
    { value: 'rust', label: 'Rust' },
    { value: 'ruby', label: 'Ruby' },
    { value: 'go', label: 'Go' },
    { value: 'kotlin', label: 'Kotlin' },
    { value: 'swift', label: 'Swift' },
    { value: 'scala', label: 'Scala' },
    { value: 'dart', label: 'Dart' },
    { value: 'php', label: 'PHP' },
    { value: 'perl', label: 'Perl' },
    { value: 'r', label: 'R' },
    { value: 'elixir', label: 'Elixir' },
    { value: 'bash', label: 'Bash' },
  ];

  const onChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleDifficultySelect = (option) => {
    setFormData({ ...formData, difficulty: option.value });
  };

  const handleLanguageSelect = (option) => {
    setFormData({ ...formData, solutionLanguage: option.value });
  };

  const handleTestCaseChange = (index, e) => {
    const values = [...testCases];
    values[index][e.target.name] = e.target.value;
    setTestCases(values);
  };

  const toggleExampleStatus = (index) => {
    const values = [...testCases];
    values[index].isExample = !values[index].isExample;
    setTestCases(values);
  };

  const addTestCase = () => {
    setTestCases([...testCases, { input: '', output: '', isExample: false }]);
  };

  const removeTestCase = (index) => {
    const values = [...testCases];
    values.splice(index, 1);
    setTestCases(values);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (!testCases.some((testCase) => testCase.isExample) || !testCases.some((testCase) => !testCase.isExample)) {
        setError('Add at least one visible example and one hidden test case before publishing.');
        return;
      }
      const normalizedCases = testCases.map((testCase) => ({
        input: testCase.input,
        expectedOutput: testCase.output,
      }));
      const body = {
        ...formData,
        referenceSolution: formData.solution,
        constraintsText: formData.constraints,
        starterTemplates: {
          [formData.solutionLanguage]: ['python', 'ruby', 'r', 'bash', 'perl'].includes(formData.solutionLanguage)
            ? `# Write your ${formData.solutionLanguage} solution here`
            : `// Write your ${formData.solutionLanguage} solution here`,
        },
        difficulty: String(formData.difficulty || 'easy').toLowerCase(),
        score: Number(formData.score),
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        visibleTestCases: normalizedCases.filter((_testCase, index) => testCases[index].isExample),
        hiddenTestCases: normalizedCases.filter((_testCase, index) => !testCases[index].isExample),
      };
      const created = await axios.post('/api/v1/challenges', body);
      await axios.post(`/api/v1/challenges/${created.data.id}/review`, {});
      await axios.post(`/api/v1/challenges/${created.data.id}/publish`, {});
      navigate('/challenges');
    } catch (err) {
      setError(err.response?.data?.error?.code || err.response?.data?.message || 'Failed to create challenge.');
    }
  };

  return (
    <div className="create-challenge-container">
      <button onClick={() => navigate('/challenges')} className="back-button" type="button">
        ← Back to Challenges
      </button>
      <form className="create-challenge-form" onSubmit={onSubmit}>
        <h2>Create a New Challenge</h2>

        <div className="form-group">
          <label htmlFor="challenge-title">Title</label>
          <input
            id="challenge-title"
            name="title"
            onChange={onChange}
            required
            type="text"
            value={title}
          />
        </div>

        <div className="form-grid">
          <CustomDropdown
            label="Difficulty"
            options={difficultyOptions}
            selected={difficulty}
            onSelect={handleDifficultySelect}
          />
          <div className="form-group">
            <label htmlFor="challenge-score">Score (1-10)</label>
            <input
              id="challenge-score"
              type="number"
              name="score"
              value={score}
              onChange={onChange}
              min="1"
              max="10"
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="challenge-description">Description (Markdown supported)</label>
          <textarea
            id="challenge-description"
            name="description"
            value={description}
            onChange={onChange}
            required
            rows="6"
          ></textarea>
        </div>

        <div className="form-group">
          <label htmlFor="challenge-constraints">
            Constraints (e.g., 1 &lt;= nums.length &lt;= 100)
          </label>
          <textarea
            id="challenge-constraints"
            name="constraints"
            onChange={onChange}
            rows="4"
            value={constraints}
          ></textarea>
        </div>

        <div className="form-group">
          <label htmlFor="challenge-tags">Tags (comma-separated)</label>
          <input id="challenge-tags" name="tags" onChange={onChange} type="text" value={tags} />
        </div>

        <CustomDropdown
          label="Solution Language"
          options={languageOptions}
          selected={languageOptions.find((opt) => opt.value === solutionLanguage)?.label}
          onSelect={handleLanguageSelect}
        />

        <div className="form-group">
          <p className="form-label" id="challenge-solution-label">
            Solution Code
          </p>
          <div className="form-editor-wrapper">
            <Editor
              height="200px"
              language={solutionLanguage}
              theme="vs-dark"
              value={solution}
              onChange={(value) => setFormData({ ...formData, solution: value })}
              options={{
                ariaLabel: 'Challenge solution code',
                fontSize: 14,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
              }}
            />
          </div>
        </div>

        <div className="form-group">
          <p className="form-label">Test Cases</p>
          {testCases.map((testCase, index) => (
            <div key={index} className="test-case-row">
              <div className="test-case-box">
                <input
                  aria-label={`Test case ${index + 1} input`}
                  type="text"
                  name="input"
                  placeholder="Input"
                  value={testCase.input}
                  onChange={(e) => handleTestCaseChange(index, e)}
                  required
                />
                <input
                  aria-label={`Test case ${index + 1} expected output`}
                  type="text"
                  name="output"
                  placeholder="Expected Output"
                  value={testCase.output}
                  onChange={(e) => handleTestCaseChange(index, e)}
                  required
                />
                <button
                  type="button"
                  className="remove-testcase-btn"
                  onClick={() => removeTestCase(index)}
                  aria-label={`Remove test case ${index + 1}`}
                >
                  <BinIcon />
                </button>
              </div>
              <button
                type="button"
                className={`test-case-toggle-btn ${testCase.isExample ? 'example' : 'hidden'}`}
                onClick={() => toggleExampleStatus(index)}
                aria-label={`Make test case ${index + 1} ${testCase.isExample ? 'hidden' : 'visible'}`}
                aria-pressed={testCase.isExample}
              >
                {testCase.isExample ? 'Example' : 'Hidden'}
              </button>
            </div>
          ))}
          <button type="button" className="add-testcase-btn" onClick={addTestCase}>
            + Add Test Case
          </button>
        </div>

        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}

        <div className="form-buttons">
          <button type="button" className="cancel-btn" onClick={() => navigate('/challenges')}>
            Cancel
          </button>
          <button type="submit" className="submit-button">
            Create Challenge
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreateChallenge;
