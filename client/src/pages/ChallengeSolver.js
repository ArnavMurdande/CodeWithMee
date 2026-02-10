import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import Editor from '@monaco-editor/react'; // ✅ Replaced react-simple-code-editor
import './ChallengeSolver.css';

// --- Custom Dropdown Component ---
const CustomDropdown = ({ options, selected, onSelect }) => {
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
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="custom-dropdown" ref={dropdownRef}>
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


// --- Comment Component ---
const Comment = ({ comment, challengeId, token, onAction }) => {
    const { user } = useContext(AuthContext);
    const [showReply, setShowReply] = useState(false);
    const [replyText, setReplyText] = useState('');

    const handleVote = async (isLike) => {
        const route = isLike ? 'like' : 'dislike';
        try {
            await axios.post(
                `http://localhost:5001/api/challenges/${challengeId}/comments/${comment._id}/${route}`,
                {},
                { headers: { 'x-auth-token': token } }
            );
            onAction(); // Trigger re-fetch in parent
        } catch (error) {
            console.error("Failed to vote on comment", error);
        }
    };

    const handleReplySubmit = async (e) => {
        e.preventDefault();
        if (!replyText.trim()) return;
        try {
            await axios.post(
                `http://localhost:5001/api/challenges/${challengeId}/comments/${comment._id}/reply`,
                { text: replyText },
                { headers: { 'x-auth-token': token } }
            );
            setReplyText('');
            setShowReply(false);
            onAction(); // Trigger re-fetch
        } catch (error) {
            console.error("Failed to post reply", error);
        }
    };

    return (
        <div className="comment">
            <div className="comment-header">
                <span className="comment-author">{comment.author?.username || 'Anonymous'}</span>
                <span className="comment-date">{new Date(comment.createdAt).toLocaleDateString()}</span>
            </div>
            <p className="comment-text">{comment.text}</p>
            <div className="comment-actions">
                <button onClick={() => handleVote(true)} className={comment.likes?.includes(user?._id) ? 'active' : ''}>
                    👍 {comment.likes?.length || 0}
                </button>
                <button onClick={() => handleVote(false)} className={comment.dislikes?.includes(user?._id) ? 'active' : ''}>
                    👎 {comment.dislikes?.length || 0}
                </button>
                <button onClick={() => setShowReply(!showReply)}>Reply</button>
            </div>
            {showReply && (
                <form onSubmit={handleReplySubmit} className="reply-form">
                    <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder={`Replying to ${comment.author?.username || 'user'}...`}
                    />
                    <div className="reply-form-actions">
                        <button type="button" onClick={() => setShowReply(false)}>Cancel</button>
                        <button type="submit">Submit</button>
                    </div>
                </form>
            )}
            {comment.replies && comment.replies.length > 0 && (
                <div className="comment-replies">
                    {comment.replies.map(reply => (
                        <Comment key={reply._id} comment={reply} challengeId={challengeId} token={token} onAction={onAction} />
                    ))}
                </div>
            )}
        </div>
    );
};


const ChallengeSolver = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { token, user } = useContext(AuthContext);

    const [challenge, setChallenge] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [code, setCode] = useState('');
    const [language, setLanguage] = useState('python');
    const [output, setOutput] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSolution, setShowSolution] = useState(false);
    const [newComment, setNewComment] = useState("");

    const languageOptions = [
        { value: 'python', label: 'Python' },
        { value: 'javascript', label: 'JavaScript' },
        { value: 'java', label: 'Java' },
        { value: 'cpp', label: 'C++' },
        { value: 'c', label: 'C' }
    ];

    const boilerplate = {
        python: 'def solve(nums, target):\n  # Your code here\n  return False',
        javascript: 'function solve(nums, target) {\n  // Your code here\n  return false;\n}',
        java: 'class Solution {\n    public boolean solve(int[] nums, int target) {\n        // Your code here\n        return false;\n    }\n}',
        cpp: 'bool solve(std::vector<int>& nums, int target) {\n    // Your code here\n    return false;\n}',
        c: 'bool solve(int nums[], int numsSize, int target) {\n    // Your code here\n    return false;\n}'
    };

    const fetchChallenge = useCallback(async () => {
        try {
            const res = await axios.get(`http://localhost:5001/api/challenges/${id}`, {
                headers: { 'x-auth-token': token },
            });
            setChallenge(res.data);
        } catch (error) {
            console.error("Failed to fetch challenge:", error);
            setOutput('Error: Could not load the challenge.');
        } finally {
            setIsLoading(false);
        }
    }, [id, token]);

    useEffect(() => {
        fetchChallenge();
    }, [fetchChallenge]);

    useEffect(() => {
        setCode(boilerplate[language] || '');
    }, [language, id]);

    const handleLanguageSelect = (option) => {
        setLanguage(option.value);
    };

    const handleLikeChallenge = async (isLike) => {
        if (!user) return;
        const route = isLike ? 'like' : 'dislike';
        try {
            const res = await axios.post(`http://localhost:5001/api/challenges/${id}/${route}`, {}, {
                headers: { 'x-auth-token': token }
            });
            setChallenge(prev => ({ ...prev, likes: res.data.likes, dislikes: res.data.dislikes }));
        } catch (error) {
            console.error("Failed to vote on challenge", error);
        }
    };

    const handleCommentSubmit = async (e) => {
        e.preventDefault();
        if (!newComment.trim()) return;
        try {
            await axios.post(
                `http://localhost:5001/api/challenges/${id}/comments`,
                { text: newComment },
                { headers: { 'x-auth-token': token } }
            );
            setNewComment("");
            fetchChallenge();
        } catch (error) {
            console.error("Failed to post comment", error);
        }
    };

    const handleCodeExecution = async (isRunAction) => {
        setIsSubmitting(true);
        setOutput(isRunAction ? 'Running on example cases...' : 'Submitting solution...');
        try {
            const res = await axios.post(
                `http://localhost:5001/api/challenges/${id}/submit`,
                { code, language, runOnly: isRunAction },
                { headers: { 'x-auth-token': token } }
            );

            const { message, results } = res.data;
            let formattedOutput = `Result: ${message}\n\n--- Test Cases ---\n`;
            results.forEach((r, i) => {
                const testCaseTitle = r.isExample ? `Example Test ${i + 1}` : `Hidden Test ${i + 1}`;
                if (r.passed) {
                    formattedOutput += `${testCaseTitle}: ✅ Passed\n`;
                } else {
                    formattedOutput += `${testCaseTitle}: ❌ Failed\n`;
                    formattedOutput += `  Input: ${r.input}\n  Expected: ${r.expected}\n  Got: ${r.output}\n`;
                }
            });
            setOutput(formattedOutput);

        } catch (error) {
            setOutput(`Execution Error: ${error.response?.data?.message || error.message}`);
        }
        setIsSubmitting(false);
    };

    if (isLoading || !challenge) {
        return <div className="solver-container"><h2>Loading Challenge...</h2></div>;
    }

    return (
        <div className="solver-page-container">
            <div className="solver-container">
                {showSolution && (
                    <div className="modal-overlay" onClick={() => setShowSolution(false)}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <h2>Solution</h2>
                            <div className="editor-wrapper">
                                <Editor
                                    height="300px"
                                    theme="vs-dark"
                                    language={language}
                                    value={challenge.solution}
                                    options={{
                                        readOnly: true,
                                        fontSize: 16,
                                        minimap: { enabled: false },
                                        scrollBeyondLastLine: false,
                                        automaticLayout: true,
                                    }}
                                />
                            </div>
                            <button className="modal-close-btn" onClick={() => setShowSolution(false)}>Close</button>
                        </div>
                    </div>
                )}
                <div className="problem-pane">
                    <div className="problem-header">
                        <button onClick={() => navigate('/challenges')} className="back-button">← Back</button>
                        <button onClick={() => setShowSolution(true)} className="solution-button">View Solution</button>
                    </div>
                    <h1>{challenge.title}</h1>
                    <p className="description">{challenge.description}</p>

                    {challenge.constraints && (
                        <>
                            <h3>Constraints</h3>
                            <pre className="constraints-list">{challenge.constraints}</pre>
                        </>
                    )}

                    <h3>Examples</h3>
                    <div className="test-cases">
                        {challenge.testCases.filter(tc => tc.isExample).map((tc, i) => (
                            <div key={i} className="test-case">
                                <strong>Input:</strong> <pre>{tc.input}</pre>
                                <strong>Output:</strong> <pre>{tc.output}</pre>
                            </div>
                        ))}
                    </div>

                    <div className="challenge-feedback">
                        <button onClick={() => handleLikeChallenge(true)} className={challenge.likes.includes(user?._id) ? 'active' : ''}>👍 {challenge.likes.length}</button>
                        <button onClick={() => handleLikeChallenge(false)} className={challenge.dislikes.includes(user?._id) ? 'active' : ''}>👎 {challenge.dislikes.length}</button>
                    </div>
                </div>

                <div className="code-pane">
                    <div className="code-pane-container">
                        <div className="editor-header">
                            <CustomDropdown
                                options={languageOptions}
                                selected={languageOptions.find(opt => opt.value === language)?.label}
                                onSelect={handleLanguageSelect}
                            />
                        </div>
                        <div className="editor-wrapper">
                            <Editor
                                height="400px"
                                theme="vs-dark"
                                language={language}
                                value={code}
                                onChange={(value) => setCode(value || '')}
                                options={{
                                    fontSize: 16,
                                    minimap: { enabled: false },
                                    scrollBeyondLastLine: false,
                                    automaticLayout: true,
                                }}
                            />
                        </div>
                        <div className="terminal">
                            <div className="terminal-header">Output</div>
                            <pre className="terminal-content">{output}</pre>
                        </div>
                        <div className="action-buttons">
                            <button className="run-btn" onClick={() => handleCodeExecution(true)} disabled={isSubmitting}>Run</button>
                            <button className="submit-btn" onClick={() => handleCodeExecution(false)} disabled={isSubmitting}>
                                {isSubmitting ? '...' : 'Submit'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="comments-section">
                <h3>Comments ({challenge.comments.length})</h3>
                <form onSubmit={handleCommentSubmit} className="comment-form">
                    <textarea
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        placeholder="Add a public comment..."
                    />
                    <button type="submit" disabled={!newComment.trim()}>Post</button>
                </form>
                <div className="comment-list">
                    {challenge.comments.map(comment => (
                        <Comment key={comment._id} comment={comment} challengeId={id} token={token} onAction={fetchChallenge} />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ChallengeSolver;
