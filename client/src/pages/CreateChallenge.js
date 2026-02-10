import React, { useState, useContext, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import Editor from '@monaco-editor/react'; // ✅ switched to Monaco
import './CreateChallenge.css';

const BinIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M7 6V3C7 2.44772 7.44772 2 8 2H16C16.5523 2 17 2.44772 17 3V6H22V8H2V6H7ZM6 8H18V21C18 21.5523 17.5523 22 17 22H7C6.44772 22 6 21.5523 6 21V8ZM9 10V19H11V10H9ZM13 10V19H15V10H13Z"></path>
  </svg>
);

const CustomDropdown = ({ label, options, selected, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const handleSelect = (option) => {
    onSelect(option);
    setIsOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="form-group custom-dropdown" ref={dropdownRef}>
      <label>{label}</label>
      <button type="button" className="dropdown-button" onClick={() => setIsOpen(!isOpen)}>
        {selected}
      </button>
      {isOpen && (
        <ul className="dropdown-menu">
          {options.map((option) => (
            <li
              key={option.value}
              onClick={() => handleSelect(option)}
              className={selected === option.label ? 'selected' : ''}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
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
  const { token } = useContext(AuthContext);
  const navigate = useNavigate();

  const { title, description, constraints, difficulty, score, tags, solution, solutionLanguage } = formData;

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
      const body = { ...formData, tags: tags.split(',').map((t) => t.trim()), testCases };
      await axios.post('http://localhost:5001/api/challenges', body, {
        headers: { 'x-auth-token': token },
      });
      navigate('/challenges');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create challenge.');
    }
  };

  return (
    <div className="create-challenge-container">
      <button onClick={() => navigate('/challenges')} className="back-button">
        ← Back to Challenges
      </button>
      <form className="create-challenge-form" onSubmit={onSubmit}>
        <h2>Create a New Challenge</h2>

        <div className="form-group">
          <label>Title</label>
          <input type="text" name="title" value={title} onChange={onChange} required />
        </div>

        <div className="form-grid">
          <CustomDropdown
            label="Difficulty"
            options={difficultyOptions}
            selected={difficulty}
            onSelect={handleDifficultySelect}
          />
          <div className="form-group">
            <label>Score (1-10)</label>
            <input type="number" name="score" value={score} onChange={onChange} min="1" max="10" required />
          </div>
        </div>

        <div className="form-group">
          <label>Description (Markdown supported)</label>
          <textarea name="description" value={description} onChange={onChange} required rows="6"></textarea>
        </div>

        <div className="form-group">
          <label>Constraints (e.g., 1 &lt;= nums.length &lt;= 100)</label>
          <textarea name="constraints" value={constraints} onChange={onChange} rows="4"></textarea>
        </div>

        <div className="form-group">
          <label>Tags (comma-separated)</label>
          <input type="text" name="tags" value={tags} onChange={onChange} />
        </div>

        <CustomDropdown
          label="Solution Language"
          options={languageOptions}
          selected={languageOptions.find((opt) => opt.value === solutionLanguage)?.label}
          onSelect={handleLanguageSelect}
        />

        <div className="form-group">
          <label>Solution Code</label>
          <div className="form-editor-wrapper">
            <Editor
              height="200px"
              language={solutionLanguage}
              theme="vs-dark"
              value={solution}
              onChange={(value) => setFormData({ ...formData, solution: value })}
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
              }}
            />
          </div>
        </div>

        <div className="form-group">
          <label>Test Cases</label>
          {testCases.map((testCase, index) => (
            <div key={index} className="test-case-row">
              <div className="test-case-box">
                <input
                  type="text"
                  name="input"
                  placeholder="Input"
                  value={testCase.input}
                  onChange={(e) => handleTestCaseChange(index, e)}
                  required
                />
                <input
                  type="text"
                  name="output"
                  placeholder="Expected Output"
                  value={testCase.output}
                  onChange={(e) => handleTestCaseChange(index, e)}
                  required
                />
                <button type="button" className="remove-testcase-btn" onClick={() => removeTestCase(index)}>
                  <BinIcon />
                </button>
              </div>
              <button
                type="button"
                className={`test-case-toggle-btn ${testCase.isExample ? 'example' : 'hidden'}`}
                onClick={() => toggleExampleStatus(index)}
              >
                {testCase.isExample ? 'Example' : 'Hidden'}
              </button>
            </div>
          ))}
          <button type="button" className="add-testcase-btn" onClick={addTestCase}>
            + Add Test Case
          </button>
        </div>

        {error && <p className="error-message">{error}</p>}

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
