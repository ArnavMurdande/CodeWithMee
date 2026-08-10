import { useState, useEffect, useContext, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from '../lib/api';
import Editor from '../components/CodeEditor';
import { AuthContext } from '../context/AuthContext';
import { getUserStorageKey } from '../lib/cache-isolation';
import RestrictedMarkdown from '../components/RestrictedMarkdown';
import AppDropdown from '../components/AppDropdown';

// --- Custom Dropdown Component ---
const CustomDropdown = ({ options, selected, onSelect, placeholder = 'Select' }) => {
  const selectedOption = options.find(
    (option) => option.value === selected || option.label === selected,
  );
  return (
    <AppDropdown
      className="custom-dropdown-sandbox"
      label={placeholder}
      onChange={(value) => onSelect(options.find((option) => option.value === value))}
      options={options}
      placeholder={placeholder}
      value={selectedOption?.value}
    />
  );
};

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
  { value: 'sqlite', label: 'SQLite' },
  { value: 'bash', label: 'Bash' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'cobol', label: 'COBOL' },
  { value: 'nasm', label: 'Assembly (NASM)' },
];

const boilerplate = {
  python: `# Welcome to the Python sandbox!
# Python is a versatile, beginner-friendly language.
# Try: variables, loops, functions, and list comprehensions.

def greet(name):
    return f"Hello, {name}!"

# List comprehension example
squares = [x**2 for x in range(1, 6)]
print(greet("CodeWithMee"))
print("Squares:", squares)`,

  javascript: `// Welcome to the JavaScript sandbox!
// JS powers the web — both frontend and backend.
// Try: arrow functions, template literals, and array methods.

const greet = (name) => \`Hello, \${name}!\`;

// Array methods example
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);

console.log(greet("CodeWithMee"));
console.log("Doubled:", doubled);`,

  java: `// Welcome to the Java sandbox!
// Java is a strongly-typed, object-oriented language.
// The entry point is always the main method inside a class.

class Main {
    public static void main(String[] args) {
        String name = "CodeWithMee";
        System.out.println("Hello, " + name + "!");

        // Array example
        int[] numbers = {1, 2, 3, 4, 5};
        int sum = 0;
        for (int n : numbers) sum += n;
        System.out.println("Sum: " + sum);
    }
}`,

  cpp: `// Welcome to the C++ sandbox!
// C++ gives you low-level control with high-level abstractions.
// Try: vectors, references, and the STL.

#include <iostream>
#include <vector>
#include <numeric>
using namespace std;

int main() {
    cout << "Hello, CodeWithMee!" << endl;

    // Vector and algorithm example
    vector<int> nums = {1, 2, 3, 4, 5};
    int sum = accumulate(nums.begin(), nums.end(), 0);
    cout << "Sum: " << sum << endl;
    return 0;
}`,

  c: `// Welcome to the C sandbox!
// C is the foundation of modern computing.
// Try: pointers, arrays, and structs.

#include <stdio.h>

int main() {
    printf("Hello, CodeWithMee!\\n");

    // Array and pointer example
    int nums[] = {1, 2, 3, 4, 5};
    int size = sizeof(nums) / sizeof(nums[0]);
    int sum = 0;
    for (int i = 0; i < size; i++) sum += nums[i];
    printf("Sum: %d\\n", sum);
    return 0;
}`,

  rust: `// Welcome to the Rust sandbox!
// Rust guarantees memory safety without garbage collection.
// Try: ownership, pattern matching, and iterators.

fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

fn main() {
    println!("{}", greet("CodeWithMee"));

    // Iterator example
    let nums = vec![1, 2, 3, 4, 5];
    let sum: i32 = nums.iter().sum();
    println!("Sum: {}", sum);
}`,

  ruby: `# Welcome to the Ruby sandbox!
# Ruby is designed for developer happiness.
# Try: blocks, symbols, and method chaining.

def greet(name)
  "Hello, #{name}!"
end

puts greet("CodeWithMee")

# Block example
numbers = [1, 2, 3, 4, 5]
sum = numbers.reduce(0) { |acc, n| acc + n }
puts "Sum: #{sum}"`,

  go: `// Welcome to the Go sandbox!
// Go is simple, fast, and built for concurrency.
// Try: goroutines, channels, and slices.

package main

import "fmt"

func greet(name string) string {
    return fmt.Sprintf("Hello, %s!", name)
}

func main() {
    fmt.Println(greet("CodeWithMee"))

    // Slice example
    numbers := []int{1, 2, 3, 4, 5}
    sum := 0
    for _, n := range numbers {
        sum += n
    }
    fmt.Println("Sum:", sum)
}`,

  kotlin: `// Welcome to the Kotlin sandbox!
// Kotlin is a modern, concise language for JVM & Android.
// Try: null safety, data classes, and extension functions.

fun greet(name: String) = "Hello, $name!"

fun main() {
    println(greet("CodeWithMee"))

    // Collection operations
    val numbers = listOf(1, 2, 3, 4, 5)
    val sum = numbers.sum()
    println("Sum: $sum")
}`,

  swift: `// Welcome to the Swift sandbox!
// Swift powers iOS, macOS, and beyond.
// Try: optionals, closures, and enums.

func greet(_ name: String) -> String {
    return "Hello, \\(name)!"
}

print(greet("CodeWithMee"))

// Array and higher-order functions
let numbers = [1, 2, 3, 4, 5]
let sum = numbers.reduce(0, +)
print("Sum: \\(sum)")`,

  scala: `// Welcome to the Scala sandbox!
// Scala blends object-oriented and functional programming on the JVM.
// Try: case classes, pattern matching, and immutability.

object Main extends App {
  def greet(name: String): String = s"Hello, $name!"

  println(greet("CodeWithMee"))

  // Collection operations
  val nums = List(1, 2, 3, 4, 5)
  val sum = nums.sum
  println(s"Sum: $sum")
}`,

  dart: `// Welcome to the Dart sandbox!
// Dart is the language behind Flutter (mobile/web apps).
// Try: classes, async/await, and null safety.

String greet(String name) => 'Hello, $name!';

void main() {
  print(greet('CodeWithMee'));

  // List operations
  var numbers = [1, 2, 3, 4, 5];
  var sum = numbers.reduce((a, b) => a + b);
  print('Sum: $sum');
}`,

  php: `<?php
// Welcome to the PHP sandbox!
// PHP powers most of the web's backend.
// Try: arrays, string interpolation, and built-in functions.

function greet($name) {
    return "Hello, $name!";
}

echo greet("CodeWithMee") . "\\n";

// Array functions
$numbers = [1, 2, 3, 4, 5];
$sum = array_sum($numbers);
echo "Sum: $sum\\n";
?>`,

  perl: `#!/usr/bin/perl
# Welcome to the Perl sandbox!
# Perl excels at text processing and regex.
# Try: regular expressions, hashes, and file operations.

use strict;
use warnings;

sub greet {
    my ($name) = @_;
    return "Hello, $name!";
}

print greet("CodeWithMee") . "\\n";

# Array and hash example
my @numbers = (1, 2, 3, 4, 5);
my $sum = 0;
$sum += $_ for @numbers;
print "Sum: $sum\\n";`,

  r: `# Welcome to the R sandbox!
# R is the go-to language for statistics and data science.
# Try: vectors, data frames, and built-in stats functions.

greet <- function(name) {
  paste("Hello,", name, "!")
}

cat(greet("CodeWithMee"), "\\n")

# Vector operations
numbers <- c(1, 2, 3, 4, 5)
cat("Mean:", mean(numbers), "\\n")
cat("Sum:", sum(numbers), "\\n")
cat("Std Dev:", sd(numbers), "\\n")`,

  elixir: `# Welcome to the Elixir sandbox!
# Elixir is a functional language built for scalability.
# Try: pattern matching, pipes, and recursion.

defmodule Greeter do
  def hello(name), do: "Hello, #{name}!"
end

IO.puts Greeter.hello("CodeWithMee")

# Pipe operator and Enum
numbers = [1, 2, 3, 4, 5]
sum = numbers |> Enum.sum()
IO.puts "Sum: #{sum}"`,

  sqlite: `-- Welcome to the SQLite sandbox!
-- Pre-loaded sample database tables:
--   students    (id, name, age, grade, gpa)
--   courses     (id, name, credits, department)
--   enrollments (student_id, course_id, semester)
--   users       (id, name, email, role, created_at)
--   products    (id, name, price, category, stock)
--   orders      (id, user_id, product_id, quantity, total_price)
--
-- Try writing queries against these tables!

-- Example: Find all students with a GPA above 3.5
SELECT name, gpa FROM students WHERE gpa > 3.5 ORDER BY gpa DESC;`,

  bash: `#!/bin/bash
# Welcome to the Bash sandbox!
# Bash is the standard Unix/Linux shell scripting language.
# Note: Dangerous commands are blocked for security.
# Try: variables, loops, conditionals, and string manipulation.

NAME="CodeWithMee"
echo "Hello, $NAME!"

# Loop example
for i in {1..5}; do
    echo "Count: $i"
done`,

  powershell: `# Welcome to the PowerShell sandbox!
# PowerShell is a task automation framework by Microsoft.
# Note: Dangerous commands are blocked for security.
# Try: variables, pipelines, and cmdlets.

$name = "CodeWithMee"
Write-Output "Hello, $name!"`,

  cobol: `       IDENTIFICATION DIVISION.
       PROGRAM-ID. HELLO-WORLD.
       PROCEDURE DIVISION.
           DISPLAY "Hello, CodeWithMee!".
           STOP RUN.`,

  nasm: `; Welcome to the Assembly (NASM) sandbox!
section .data
    msg db "Hello, CodeWithMee!", 10
    len equ $ - msg

section .text
    global _start

_start:
    mov eax, 4
    mov ebx, 1
    mov ecx, msg
    mov edx, len
    int 0x80

    mov eax, 1
    xor ebx, ebx
    int 0x80`,
};

const monacoLanguageMap = {
  python: 'python',
  javascript: 'javascript',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  rust: 'rust',
  ruby: 'ruby',
  go: 'go',
  kotlin: 'kotlin',
  swift: 'swift',
  scala: 'scala',
  dart: 'dart',
  php: 'php',
  perl: 'perl',
  r: 'r',
  elixir: 'elixir',
  sqlite: 'sql',
  bash: 'shell',
  powershell: 'powershell',
  cobol: 'cobol',
  nasm: 'plaintext',
};

const formatMonacoLanguage = (lang) => monacoLanguageMap[lang?.toLowerCase()] || lang || 'python';

const Sandbox = ({ setPageTitle }) => {
  const { token, user } = useContext(AuthContext);
  const [searchParams] = useSearchParams();
  const topic = searchParams.get('topic');
  const youtubeQuery = searchParams.get('q');
  const pathwayParam = searchParams.get('pathway') || '';

  // --- Layout State ---
  const [verticalSplit, setVerticalSplit] = useState(50);
  const [leftHorizontalSplit, setLeftHorizontalSplit] = useState(60);
  const [rightHorizontalSplit, setRightHorizontalSplit] = useState(70);
  const [isDragging, setIsDragging] = useState(null); // 'vertical', 'left', 'right'

  // --- Component State ---
  const [videoId, setVideoId] = useState('');
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [showResumeOverlay, setShowResumeOverlay] = useState(false);
  const [savedProgress, setSavedProgress] = useState(null);
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState(() => boilerplate.python);
  const [output, setOutput] = useState('');
  const [isCodeRunning, setIsCodeRunning] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isDebugging, setIsDebugging] = useState(false);
  const chatHistoryRef = useRef(null);
  const sandboxContainerRef = useRef(null);

  // --- Active Recall Checkpoint State ---
  const ytPlayerRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const ytPlayerContainerRef = useRef(null);
  const videoCacheRef = useRef(new Map());
  const videoFetchRequestIdRef = useRef(0);

  // User pathways and active selection state
  const [userRoadmaps, setUserRoadmaps] = useState([]);
  const [selectedPathway, setSelectedPathway] = useState(pathwayParam || 'General');
  const [selectedChapter, setSelectedChapter] = useState(topic || 'General');
  const [allChats, setAllChats] = useState({});

  useEffect(() => {
    if (pathwayParam) setSelectedPathway(pathwayParam);
    if (topic) setSelectedChapter(topic);
  }, [pathwayParam, topic]);

  // Monaco editor ref
  const monacoEditorRef = useRef(null);
  const editorContainerRef = useRef(null);
  const layoutTimerRef = useRef(null);
  const rafRef = useRef(null);
  const pendingMoveRef = useRef(null);

  // Fetch user-created roadmaps (from backend + localStorage)
  const fetchUserRoadmaps = useCallback(async () => {
    let localRoadmaps = [];
    try {
      const storageKey = getUserStorageKey(user?.id, 'saved_roadmaps');
      const raw = localStorage.getItem(storageKey);
      if (raw) localRoadmaps = JSON.parse(raw);
    } catch (err) {
      console.warn('Error reading local roadmaps', err);
    }

    let serverRoadmaps = [];
    if (token) {
      try {
        const res = await axios.get('/api/v1/roadmaps/my-roadmaps');
        if (Array.isArray(res.data)) {
          serverRoadmaps = res.data;
        }
      } catch (err) {
        console.warn('Error fetching server roadmaps', err);
      }
    }

    const map = new Map();
    [...localRoadmaps, ...serverRoadmaps].forEach((r) => {
      if (r && (r.title || r.name)) {
        map.set(r.title || r.name, r);
      }
    });

    const merged = Array.from(map.values());
    setUserRoadmaps(merged);
    return merged;
  }, [token]);

  useEffect(() => {
    fetchUserRoadmaps();
  }, [fetchUserRoadmaps]);

  // Available user pathways for dropdown (strictly user-created + current URL pathway)
  const availablePathways = useMemo(() => {
    const list = userRoadmaps.map((r) => r.title || r.name).filter(Boolean);

    if (pathwayParam && !list.includes(pathwayParam)) {
      list.unshift(pathwayParam);
    }
    if (selectedPathway && selectedPathway !== 'General' && !list.includes(selectedPathway)) {
      list.unshift(selectedPathway);
    }

    const unique = Array.from(new Set(list));
    if (unique.length === 0) return ['General'];
    return unique;
  }, [userRoadmaps, pathwayParam, selectedPathway]);

  // Chapters for the currently selected pathway
  const availableChapters = useMemo(() => {
    if (!selectedPathway || selectedPathway === 'General') {
      return topic ? [topic] : ['General'];
    }
    const matchedRoadmap = userRoadmaps.find(
      (r) => (r.title || r.name) === selectedPathway,
    );
    if (!matchedRoadmap) {
      return topic ? [topic] : ['General'];
    }

    const topicsList = matchedRoadmap.topics || matchedRoadmap.chapters || [];
    const chapterNames = topicsList
      .map((t) => (typeof t === 'string' ? t : t.topic || t.title))
      .filter(Boolean);

    if (chapterNames.length === 0) return ['General'];
    return Array.from(new Set(chapterNames));
  }, [userRoadmaps, selectedPathway, topic]);

  // Fetch video for active pathway + chapter context
  const fetchVideoForContext = useCallback(
    async (pathwayStr, chapterStr) => {
      const currentRequestId = ++videoFetchRequestIdRef.current;
      setIsVideoLoading(true);
      setShowResumeOverlay(false);
      setSavedProgress(null);

      let query;
      if (youtubeQuery && chapterStr === topic && pathwayStr === pathwayParam) {
        if (pathwayStr && pathwayStr !== 'General' && !youtubeQuery.toLowerCase().includes(pathwayStr.toLowerCase())) {
          query = `${pathwayStr} ${youtubeQuery}`;
        } else {
          query = youtubeQuery;
        }
      } else {
        const parts = [];
        if (pathwayStr && pathwayStr !== 'General') parts.push(pathwayStr);
        if (chapterStr && chapterStr !== 'General') parts.push(chapterStr);
        query = parts.join(' ').trim() || 'programming tutorial';
      }

      if (videoCacheRef.current.has(query)) {
        if (currentRequestId === videoFetchRequestIdRef.current) {
          setVideoId(videoCacheRef.current.get(query));
          setIsVideoLoading(false);
        }
        return;
      }

      try {
        const res = await axios.get(`/api/v1/videos/search?q=${encodeURIComponent(query)}`);
        if (currentRequestId !== videoFetchRequestIdRef.current) return;
        const vid = res.data?.videoId || 'rfscVS0vtbw';
        videoCacheRef.current.set(query, vid);
        setVideoId(vid);
      } catch (err) {
        if (currentRequestId !== videoFetchRequestIdRef.current) return;
        console.error('Failed to fetch video for context', err);
        setVideoId('rfscVS0vtbw');
      } finally {
        if (currentRequestId === videoFetchRequestIdRef.current) {
          setIsVideoLoading(false);
        }
      }
    },
    [youtubeQuery, topic, pathwayParam],
  );

  // --- Smart Language Detection ---
  const detectLanguageFromContext = (pathwayStr, topicStr) => {
    const combined = `${pathwayStr || ''} ${topicStr || ''}`.toLowerCase();
    if (!combined.trim()) return null;
    const pathwayLower = (pathwayStr || '').toLowerCase();

    if (/\bjava\b/i.test(pathwayLower) && !/javascript/i.test(pathwayLower)) return 'java';
    if (/\bpython\b/i.test(pathwayLower)) return 'python';
    if (/\bjavascript\b|\bjs\b|\breact\b|\bnode/i.test(pathwayLower)) return 'javascript';
    if (/\bc\+\+|\bcpp\b/i.test(pathwayLower)) return 'cpp';
    if (/\bsql\b/i.test(pathwayLower)) return 'sqlite';
    if (/\brust\b/i.test(pathwayLower)) return 'rust';
    if (/\bgo\b|\bgolang\b/i.test(pathwayLower)) return 'go';
    if (/\bruby\b/i.test(pathwayLower)) return 'ruby';
    if (/\bphp\b/i.test(pathwayLower)) return 'php';
    if (/\bkotlin\b/i.test(pathwayLower)) return 'kotlin';
    if (/\bswift\b/i.test(pathwayLower)) return 'swift';
    if (/\bscala\b/i.test(pathwayLower)) return 'scala';
    if (/\bdart\b|\bflutter\b/i.test(pathwayLower)) return 'dart';
    if (/\bbash\b|\bshell\b|\blinux\b/i.test(pathwayLower)) return 'bash';

    const t = combined;
    if (/\b(sql|sqlite|database|query|queries|relational)\b/.test(t)) return 'sqlite';
    if (/\b(javascript|js|node\.?js|react|vue|express|dom|fetch)\b/.test(t)) return 'javascript';
    if (/\b(python|django|flask|pandas|numpy|matplotlib|machine.?learning)\b/.test(t)) return 'python';
    if (/\b(java|spring|hibernate|maven|gradle)\b/i.test(t) && !/javascript/i.test(t)) return 'java';
    if (/\b(c\+\+|cpp|stl|vector|pointer)\b/.test(t)) return 'cpp';
    if (/\b(rust|cargo)\b/.test(t)) return 'rust';
    if (/\b(golang|goroutine)\b/.test(t)) return 'go';
    return null;
  };

  useEffect(() => {
    const title = topic || 'General Sandbox';
    setPageTitle(title);
    const detected = detectLanguageFromContext(pathwayParam, topic);
    if (detected) setLanguage(detected);
    return () => setPageTitle('');
  }, [topic, pathwayParam, setPageTitle]);

  useEffect(() => {
    setCode(boilerplate[language] || '');
  }, [language]);

  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatHistory]);

  // Load YouTube IFrame API
  useEffect(() => {
    if (window.YT && window.YT.Player) return;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript.parentNode.insertBefore(tag, firstScript);
  }, []);

  // Auto-complete chapter when video is watched to completion
  const autoCompleteChapter = useCallback(
    async (topicTitle, pathwayTitle) => {
      const activeTopic = topicTitle || selectedChapter || topic;
      const activePathway = pathwayTitle || selectedPathway || pathwayParam;
      if (!activeTopic || activeTopic === 'General') return;

      try {
        const storageKey = getUserStorageKey(user?.id, 'saved_roadmaps');
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const roadmaps = JSON.parse(raw);
        let targetRoadmapId = null;
        let didUpdate = false;

        const updatedRoadmaps = roadmaps.map((r) => {
          const matchesPathway =
            !activePathway ||
            activePathway === 'General' ||
            r.title?.toLowerCase() === activePathway.toLowerCase() ||
            String(r._id || r.id) === String(activePathway);

          const hasTopic = r.topics?.some(
            (t) => t.topic?.toLowerCase() === activeTopic.toLowerCase(),
          );

          if ((matchesPathway || hasTopic) && r.topics) {
            targetRoadmapId = r._id || r.id;
            didUpdate = true;
            return {
              ...r,
              topics: r.topics.map((t) =>
                t.topic?.toLowerCase() === activeTopic.toLowerCase()
                  ? { ...t, completed: true }
                  : t,
              ),
            };
          }
          return r;
        });

        if (didUpdate) {
          localStorage.setItem(storageKey, JSON.stringify(updatedRoadmaps));
          setUserRoadmaps(updatedRoadmaps);
        }

        if (token && targetRoadmapId) {
          try {
            await axios.put('/api/v1/roadmaps/progress', {
              roadmapId: targetRoadmapId,
              topic: activeTopic,
              completed: true,
            });
          } catch (err) {
            console.error('Failed to sync chapter completion to server', err);
          }
        }
      } catch (err) {
        console.warn('Auto-complete chapter failed', err);
      }
    },
    [token, selectedChapter, topic, selectedPathway, pathwayParam],
  );

  // Save video progress to backend + localStorage
  const saveVideoProgress = useCallback(
    async (vid, time, dur) => {
      if (!vid || time === undefined) return;
      const floorTime = Math.floor(time);
      const floorDur = Math.floor(dur || 0);

      try {
        const vidStorageKey = getUserStorageKey(user?.id, `vid_progress_${vid}`);
        localStorage.setItem(
          vidStorageKey,
          JSON.stringify({
            timestamp: floorTime,
            duration: floorDur,
            topic: selectedChapter || topic || '',
            pathway: selectedPathway || pathwayParam || '',
            updatedAt: Date.now(),
          }),
        );
      } catch (err) {
        console.warn('LocalStorage video save failed', err);
      }

      if (floorDur > 0 && (floorTime >= floorDur - 10 || floorTime / floorDur >= 0.9)) {
        autoCompleteChapter(selectedChapter || topic, selectedPathway || pathwayParam);
      }

      if (token) {
        try {
          await axios.put('/api/v1/learning/video-progress', {
            videoId: vid,
            timestamp: floorTime,
            duration: floorDur,
            topic: selectedChapter || topic || '',
            pathway: selectedPathway || pathwayParam || '',
          });
        } catch (err) {
          console.error('Failed to save video progress to server', err);
        }
      }
    },
    [token, user?.id, topic, pathwayParam, selectedChapter, selectedPathway, autoCompleteChapter],
  );

  // Fetch video progress from server or localStorage
  const fetchVideoProgress = useCallback(
    async (vid) => {
      if (!vid) return null;
      let serverProgress = null;

      if (token) {
        try {
          const res = await axios.get(`/api/v1/learning/video-progress/${vid}`);
          if (res.data && res.data.timestamp) {
            serverProgress = res.data;
          }
        } catch (err) {
          console.warn('Failed to fetch server video progress', err);
        }
      }

      let localProgress = null;
      try {
        const vidStorageKey = getUserStorageKey(user?.id, `vid_progress_${vid}`);
        const raw = localStorage.getItem(vidStorageKey);
        if (raw) localProgress = JSON.parse(raw);
      } catch (err) {
        console.warn('Failed to read local video progress', err);
      }

      if (serverProgress && localProgress) {
        return serverProgress.timestamp >= localProgress.timestamp ? serverProgress : localProgress;
      }
      return serverProgress || localProgress || null;
    },
    [token],
  );

  // Initialize YouTube player & handle video progress resume
  useEffect(() => {
    if (!videoId || isVideoLoading) return;

    const initPlayer = async () => {
      const progress = await fetchVideoProgress(videoId);
      const startSeconds = progress?.timestamp || 0;
      const totalDuration = progress?.duration || 0;

      const isNearEnd = totalDuration > 0 && startSeconds >= totalDuration - 10;
      if (startSeconds >= 3 && !isNearEnd) {
        setSavedProgress({ timestamp: startSeconds, duration: totalDuration });
        setShowResumeOverlay(true);
      } else {
        setSavedProgress(null);
        setShowResumeOverlay(false);
      }

      const waitForYT = () =>
        new Promise((resolve) => {
          if (window.YT && window.YT.Player) return resolve();
          window.onYouTubeIframeAPIReady = resolve;
        });
      await waitForYT();

      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {}
        ytPlayerRef.current = null;
      }

      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }

      if (!ytPlayerContainerRef.current) return;

      ytPlayerRef.current = new window.YT.Player(ytPlayerContainerRef.current, {
        videoId: videoId,
        width: '100%',
        height: '100%',
        host: 'https://www.youtube.com',
        playerVars: {
          autoplay: 0,
          rel: 0,
          modestbranding: 1,
          enablejsapi: 1,
          origin: window.location.origin,
          widget_referrer: window.location.origin,
          playsinline: 1,
          start: 0,
        },
        events: {
          onReady: () => {},
          onStateChange: (event) => {
            const player = event.target;
            if (event.data === window.YT.PlayerState.PLAYING) {
              if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
              progressIntervalRef.current = setInterval(() => {
                try {
                  const currentTime = player.getCurrentTime();
                  const duration = player.getDuration();
                  if (currentTime && duration) {
                    saveVideoProgress(videoId, currentTime, duration);
                  }
                } catch {}
              }, 5000);
            } else if (event.data === window.YT.PlayerState.PAUSED) {
              if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
              }
              try {
                const currentTime = player.getCurrentTime();
                const duration = player.getDuration();
                if (currentTime && duration) {
                  saveVideoProgress(videoId, currentTime, duration);
                }
              } catch {}
            } else if (event.data === window.YT.PlayerState.ENDED) {
              if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
              }
              try {
                const duration = player.getDuration();
                saveVideoProgress(videoId, duration, duration);
                autoCompleteChapter(selectedChapter || topic, selectedPathway || pathwayParam);
              } catch {}
            }
          },
        },
      });
    };

    initPlayer();

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [videoId, isVideoLoading, fetchVideoProgress, saveVideoProgress]);

  // Resume & Start Fresh video handlers
  const handleResumeVideo = () => {
    setShowResumeOverlay(false);
    if (ytPlayerRef.current && savedProgress?.timestamp) {
      ytPlayerRef.current.seekTo(savedProgress.timestamp, true);
      ytPlayerRef.current.playVideo();
    }
  };

  const handleStartFresh = () => {
    setShowResumeOverlay(false);
    setSavedProgress(null);
    if (ytPlayerRef.current) {
      ytPlayerRef.current.seekTo(0, true);
    }
  };

  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  // Initial data loading for video and AI chat history
  useEffect(() => {
    const fetchData = async () => {
      fetchVideoForContext(selectedPathway, selectedChapter);

      if (!token) return;
      try {
        const res = await axios.get('/api/v1/ai/sandbox-history');
        setAllChats(res.data.chatsByPathway || {});
        const pw = selectedPathway;
        const ch = selectedChapter;
        const chapterChats = res.data.chatsByPathway?.[pw]?.[ch] || [];
        const history = chapterChats.flatMap((conv) => [
          { sender: 'user', message: conv.prompt },
          { sender: 'ai', message: conv.response },
        ]);
        setChatHistory(history);
      } catch (err) {
        console.error('Failed to fetch chat history', err);
      }
    };
    fetchData();
  }, [token, fetchVideoForContext, selectedPathway, selectedChapter]);

  const handleRunCode = async () => {
    setIsCodeRunning(true);
    setOutput('Running code...');
    try {
      const res = await axios.post('/api/v1/execution/run', { code, language });
      setOutput(res.data.output || 'Code executed with no output.');
    } catch (err) {
      const apiError = err.response?.data?.error;
      setOutput(
        typeof apiError === 'string'
          ? apiError
          : apiError?.message || apiError?.code || 'Failed to run code.',
      );
    }
    setIsCodeRunning(false);
  };

  const handleAskAI = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || isAiLoading) return;
    const newHistory = [...chatHistory, { sender: 'user', message: chatInput }];
    setChatHistory(newHistory);
    const currentInput = chatInput;
    setChatInput('');
    setIsAiLoading(true);
    try {
      const res = await axios.post('/api/v1/ai/chat', {
        question: currentInput,
        code,
        pathway: selectedPathway,
        chapter: selectedChapter,
      });
      setChatHistory([...newHistory, { sender: 'ai', message: res.data.answer }]);

      setAllChats((prev) => {
        const updated = { ...prev };
        if (!updated[selectedPathway]) updated[selectedPathway] = {};
        if (!updated[selectedPathway][selectedChapter])
          updated[selectedPathway][selectedChapter] = [];
        updated[selectedPathway][selectedChapter] = [
          ...updated[selectedPathway][selectedChapter],
          { prompt: currentInput, response: res.data.answer, timestamp: new Date().toISOString() },
        ];
        return updated;
      });
    } catch {
      setChatHistory([
        ...newHistory,
        { sender: 'ai', message: "Sorry, I'm having trouble connecting right now." },
      ]);
    }
    setIsAiLoading(false);
  };

  // Switch pathway context
  const handlePathwaySwitch = (pw) => {
    setSelectedPathway(pw);
    let matchedChapters = [];
    const matchedRoadmap = userRoadmaps.find((r) => (r.title || r.name) === pw);
    if (matchedRoadmap) {
      const topicsList = matchedRoadmap.topics || matchedRoadmap.chapters || [];
      matchedChapters = topicsList
        .map((t) => (typeof t === 'string' ? t : t.topic || t.title))
        .filter(Boolean);
    }
    const firstChapter = matchedChapters[0] || 'General';
    setSelectedChapter(firstChapter);

    const chapterChats = allChats?.[pw]?.[firstChapter] || [];
    const history = chapterChats.flatMap((conv) => [
      { sender: 'user', message: conv.prompt },
      { sender: 'ai', message: conv.response },
    ]);
    setChatHistory(history);
  };

  // Switch chapter context
  const handleChapterSwitch = (ch) => {
    setSelectedChapter(ch);
    const chapterChats = allChats?.[selectedPathway]?.[ch] || [];
    const history = chapterChats.flatMap((conv) => [
      { sender: 'user', message: conv.prompt },
      { sender: 'ai', message: conv.response },
    ]);
    setChatHistory(history);
  };

  // Clear chat history for current chapter
  const handleClearChat = async () => {
    if (!window.confirm(`Clear all AI chat for "${selectedChapter}" in "${selectedPathway}"?`))
      return;
    try {
      await axios.delete(
        `/api/v1/ai/sandbox-history?pathway=${encodeURIComponent(selectedPathway)}&chapter=${encodeURIComponent(selectedChapter)}`,
      );
      setChatHistory([]);
      setAllChats((prev) => {
        const updated = { ...prev };
        if (updated[selectedPathway]) {
          delete updated[selectedPathway][selectedChapter];
        }
        return updated;
      });
    } catch (err) {
      console.error('Failed to clear chat history', err);
    }
  };

  // Debug button handler
  const handleDebug = async () => {
    if (isDebugging) return;
    setIsDebugging(true);
    try {
      const res = await axios.post('/api/v1/ai/debug', {
        code,
        output,
        language,
        topic: selectedChapter || topic || 'General',
      });
      if (res.data.correctedCode) {
        setCode(res.data.correctedCode);
        setOutput(
          '✅ Debug complete! Check the code editor for corrections and explanations in comments.',
        );
      }
    } catch (err) {
      setOutput('❌ Debug failed: ' + (err.response?.data?.error || 'Could not reach AI.'));
    }
    setIsDebugging(false);
  };

  // Resizing Logic with frame-by-frame Monaco layout update
  const isDraggingRef = useRef(null);

  const handleDragStart = (dividerType) => (e) => {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('cwm:close-dropdowns'));
    isDraggingRef.current = dividerType;
    setIsDragging(dividerType);
    document.body.style.cursor = dividerType === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = null;
    setIsDragging(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      pendingMoveRef.current = null;
    }

    if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
    layoutTimerRef.current = setTimeout(() => {
      try {
        monacoEditorRef.current?.layout();
      } catch {}
    }, 50);
  }, []);

  const handleDragMove = useCallback((e) => {
    const dragType = isDraggingRef.current;
    if (!dragType) return;

    const touch = e.touches && e.touches.length > 0 ? e.touches[0] : null;
    const clientX = touch ? touch.clientX : e.clientX;
    const clientY = touch ? touch.clientY : e.clientY;

    pendingMoveRef.current = { clientX, clientY, dragType };

    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        const move = pendingMoveRef.current;
        rafRef.current = null;
        pendingMoveRef.current = null;
        if (!move) return;

        if (move.dragType === 'vertical') {
          const container = sandboxContainerRef.current;
          if (!container) return;
          const rect = container.getBoundingClientRect();
          const newSplit = ((move.clientX - rect.left) / rect.width) * 100;
          setVerticalSplit(Math.max(20, Math.min(80, newSplit)));
          try {
            monacoEditorRef.current?.layout();
          } catch {}
        } else if (move.dragType === 'left') {
          const container = sandboxContainerRef.current?.querySelector('.left-pane');
          if (!container) return;
          const rect = container.getBoundingClientRect();
          const newSplit = ((move.clientY - rect.top) / rect.height) * 100;
          setLeftHorizontalSplit(Math.max(15, Math.min(85, newSplit)));
        } else if (move.dragType === 'right') {
          const container = sandboxContainerRef.current?.querySelector('.right-pane');
          if (!container) return;
          const rect = container.getBoundingClientRect();
          const newSplit = ((move.clientY - rect.top) / rect.height) * 100;
          setRightHorizontalSplit(Math.max(15, Math.min(85, newSplit)));
          try {
            monacoEditorRef.current?.layout();
          } catch {}
        }
      });
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchmove', handleDragMove, { passive: false });
    document.addEventListener('touchend', handleDragEnd);
    document.addEventListener('touchcancel', handleDragEnd);

    return () => {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.removeEventListener('touchmove', handleDragMove);
      document.removeEventListener('touchend', handleDragEnd);
      document.removeEventListener('touchcancel', handleDragEnd);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [handleDragMove, handleDragEnd]);

  const handleEditorMount = (editor) => {
    monacoEditorRef.current = editor;
    setTimeout(() => {
      try {
        editor.layout();
      } catch {}
    }, 100);

    if (editorContainerRef.current) {
      const ro = new ResizeObserver(() => {
        if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
        layoutTimerRef.current = setTimeout(() => {
          try {
            editor.layout();
          } catch {}
        }, 50);
      });
      ro.observe(editorContainerRef.current);
    }
  };

  return (
    <div className="sandbox-page-container">
      {isDragging && (
        <div
          className="drag-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            cursor: isDragging === 'vertical' ? 'col-resize' : 'row-resize',
          }}
        />
      )}
      <div className="sandbox-container" ref={sandboxContainerRef}>
        <div className="left-pane" style={{ width: `calc(${verticalSplit}% - 10px)` }}>
          <div className="video-pane" style={{ height: `calc(${leftHorizontalSplit}% - 10px)` }}>
            {isVideoLoading ? (
              <p className="loading-video">Loading video...</p>
            ) : videoId ? (
              <div className="youtube-embed-wrapper">
                <div ref={ytPlayerContainerRef} style={{ width: '100%', height: '100%' }} />
                {showResumeOverlay && savedProgress && (
                  <div className="video-resume-overlay">
                    <div className="resume-overlay-content">
                      <div className="resume-icon">
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                      </div>
                      <p className="resume-text">
                        Continue from <strong>{formatTime(savedProgress.timestamp)}</strong>?
                      </p>
                      <div className="resume-actions">
                        <button className="resume-btn" onClick={handleResumeVideo}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                          Resume
                        </button>
                        <button className="start-fresh-btn" onClick={handleStartFresh}>
                          Start Fresh
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="loading-video">No video found for this topic.</p>
            )}
          </div>
          <div
            className="resize-handle horizontal"
            onMouseDown={handleDragStart('left')}
            onTouchStart={handleDragStart('left')}
          >
            <div className="handle-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
          <div
            className="ai-assistant"
            style={{ height: `calc(${100 - leftHorizontalSplit}% - 10px)` }}
          >
            <div className="chat-context-bar">
              <CustomDropdown
                options={availablePathways.map((p) => ({ label: p, value: p }))}
                selected={selectedPathway}
                onSelect={(opt) => handlePathwaySwitch(opt.value)}
                placeholder="Select Pathway"
              />
              <CustomDropdown
                options={availableChapters.map((ch) => ({ label: ch, value: ch }))}
                selected={selectedChapter}
                onSelect={(opt) => handleChapterSwitch(opt.value)}
                placeholder="Select Chapter"
              />
              <button
                className="clear-chat-btn"
                onClick={handleClearChat}
                title="Clear chat for this chapter"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
            <div className="chat-history" ref={chatHistoryRef}>
              {chatHistory.length === 0 && (
                <div className="chat-empty-state">
                  No chat history for this chapter. Ask Mee a question!
                </div>
              )}
              {chatHistory.map((chat, index) => (
                <div key={index} className={`chat-message ${chat.sender}`}>
                  <div>
                    {chat.sender === 'ai' ? (
                      <RestrictedMarkdown source={chat.message} />
                    ) : (
                      <p>{chat.message}</p>
                    )}
                  </div>
                </div>
              ))}
              {isAiLoading && (
                <div className="chat-message ai">
                  <div className="thinking-indicator">Mee is thinking...</div>
                </div>
              )}
            </div>
            <form className="chat-input-form" onSubmit={handleAskAI}>
              <input
                aria-label="Ask the learning assistant"
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask Mee a question..."
                disabled={isAiLoading}
              />
              <button type="submit" disabled={isAiLoading}>
                Send
              </button>
              <button
                type="button"
                className="debug-btn"
                onClick={handleDebug}
                disabled={isDebugging}
                title="Debug: Analyze errors and fix code"
              >
                {isDebugging ? (
                  <span className="debug-spinner">...</span>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3.003 3.003 0 116 0v1"></path>
                    <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6"></path>
                    <path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M6 17H3M21 5c0 2.1-1.6 3.8-3.53 4M18 13h4M18 17h3"></path>
                  </svg>
                )}
              </button>
            </form>
          </div>
        </div>
        <div
          className="resize-handle vertical"
          onMouseDown={handleDragStart('vertical')}
          onTouchStart={handleDragStart('vertical')}
        >
          <div className="handle-dots">
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="right-pane" style={{ width: `calc(${100 - verticalSplit}% - 10px)` }}>
          <div
            className="editor-pane"
            ref={editorContainerRef}
            style={{ height: `calc(${rightHorizontalSplit}% - 10px)` }}
          >
            <div className="editor-header">
              <CustomDropdown
                options={languageOptions}
                selected={languageOptions.find((opt) => opt.value === language)?.label || 'Select'}
                onSelect={(option) => setLanguage(option.value)}
              />
              <button onClick={handleRunCode} className="run-button" disabled={isCodeRunning}>
                {isCodeRunning ? 'Running...' : 'Run Code'}
              </button>
            </div>
            <div className="editor-wrapper">
              <Editor
                height="100%"
                width="100%"
                language={formatMonacoLanguage(language)}
                value={code}
                theme="vs-dark"
                onChange={(value) => setCode(value || '')}
                onMount={handleEditorMount}
                options={{
                  ariaLabel: 'Practice code editor',
                  fontSize: 16,
                  minimap: { enabled: false },
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                }}
              />
            </div>
          </div>
          <div
            className="resize-handle horizontal"
            onMouseDown={handleDragStart('right')}
            onTouchStart={handleDragStart('right')}
          >
            <div className="handle-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
          <div
            className="terminal-pane"
            style={{ height: `calc(${100 - rightHorizontalSplit}% - 10px)` }}
          >
            <h3>Terminal</h3>
            <pre className="output-text">
              {output || 'Click "Run Code" to see the output here...'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sandbox;
