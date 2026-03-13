import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import Editor from '@monaco-editor/react';
import { AuthContext } from '../context/AuthContext';
import './Sandbox.css';

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
        <div className="custom-dropdown-sandbox" ref={dropdownRef}>
            <button type="button" className="dropdown-button-sandbox" onClick={() => setIsOpen(!isOpen)}>
                {selected}
            </button>
            {isOpen && (
                <ul className="dropdown-menu-sandbox">
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


// --- Markdown Parser for AI Chat ---
const parseMarkdown = (text) => {
  text = text || '';
  text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const languageClass = lang ? `language-${lang}` : '';
    const escapedCode = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre><code class="${languageClass}">${escapedCode}</code></pre>`;
  });
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/^\s*-\s+(.*)/gm, '<li>$1</li>');
  text = text.replace(/(\<li\>.*\<\/li\>)/gs, '<ul>$1</ul>');
  return text.replace(/\n/g, '<br />');
};

const Sandbox = ({ setPageTitle }) => {
  const { token } = useContext(AuthContext);
  const [searchParams] = useSearchParams();
  const topic = searchParams.get('topic');
  const youtubeQuery = searchParams.get('q');
  const pathwayParam = searchParams.get('pathway') || '';
  const roadmapIdParam = searchParams.get('roadmapId') || '';

  // --- Layout State ---
  const [verticalSplit, setVerticalSplit] = useState(50);
  const [leftHorizontalSplit, setLeftHorizontalSplit] = useState(60);
  const [rightHorizontalSplit, setRightHorizontalSplit] = useState(70);
  const [isDragging, setIsDragging] = useState(null); // 'vertical', 'left', 'right'

  // --- Component State ---
  const [videoId, setVideoId] = useState('');
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState('');
  const [output, setOutput] = useState('');
  const [isCodeRunning, setIsCodeRunning] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isDebugging, setIsDebugging] = useState(false);
  const chatHistoryRef = useRef(null);
  const sandboxContainerRef = useRef(null);

  // --- Active Recall Checkpoint State ---
  const [savedProgress, setSavedProgress] = useState(null); // { timestamp, duration }
  const [showResumeOverlay, setShowResumeOverlay] = useState(false);
  const [videoProgressPercent, setVideoProgressPercent] = useState(0);
  const ytPlayerRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const ytPlayerContainerRef = useRef(null);

  // Chat context selectors
  const [selectedPathway, setSelectedPathway] = useState(pathwayParam || 'General');
  const [selectedChapter, setSelectedChapter] = useState(topic || 'General');
  const [availableRoadmaps, setAvailableRoadmaps] = useState([]);
  const [allChats, setAllChats] = useState({});

  // Monaco editor ref
  const monacoEditorRef = useRef(null);
  const editorContainerRef = useRef(null);
  const layoutTimerRef = useRef(null);

  // rAF throttling refs
  const rafRef = useRef(null);
  const pendingMoveRef = useRef(null);

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

# Block and method example
numbers = [1, 2, 3, 4, 5]
squares = numbers.map { |n| n ** 2 }
puts "Squares: #{squares.inspect}"`,

    go: `// Welcome to the Go sandbox!
// Go is built for simplicity, concurrency, and speed.
// Try: goroutines, slices, and maps.

package main

import "fmt"

func greet(name string) string {
    return fmt.Sprintf("Hello, %s!", name)
}

func main() {
    fmt.Println(greet("CodeWithMee"))

    // Slice example
    nums := []int{1, 2, 3, 4, 5}
    sum := 0
    for _, n := range nums {
        sum += n
    }
    fmt.Println("Sum:", sum)
}`,

    kotlin: `// Welcome to the Kotlin sandbox!
// Kotlin is a modern, concise JVM language (used for Android).
// Try: data classes, null safety, and extension functions.

fun greet(name: String) = "Hello, $name!"

fun main() {
    println(greet("CodeWithMee"))

    // Collection operations
    val numbers = listOf(1, 2, 3, 4, 5)
    val even = numbers.filter { it % 2 == 0 }
    println("Even numbers: $even")
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
-- A sample database is pre-loaded with tables:
--   students (id, name, age, grade, gpa)
--   courses  (id, name, credits, department)
--   enrollments (student_id, course_id, semester)
--
-- Try writing queries against these tables!

-- Example: Find all students with a GPA above 3.5
SELECT name, gpa FROM students WHERE gpa > 3.5 ORDER BY gpa DESC;

-- Example: Join to see which courses each student is enrolled in
-- SELECT s.name, c.name AS course, e.semester
-- FROM students s
-- JOIN enrollments e ON s.id = e.student_id
-- JOIN courses c ON e.course_id = c.id;`,

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
done

# Conditional example
if [ 10 -gt 5 ]; then
    echo "10 is greater than 5"
fi`,

    powershell: `# Welcome to the PowerShell sandbox!
# PowerShell is a task automation framework by Microsoft.
# Note: Dangerous commands are blocked for security.
# Try: variables, pipelines, and cmdlets.

$name = "CodeWithMee"
Write-Output "Hello, $name!"

# Array and pipeline example
$numbers = 1..5
$sum = ($numbers | Measure-Object -Sum).Sum
Write-Output "Sum of 1-5: $sum"

# String manipulation
$greeting = "Hello World"
Write-Output "Uppercase: $($greeting.ToUpper())"`,

    cobol: `       IDENTIFICATION DIVISION.
       PROGRAM-ID. HELLO-WORLD.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-NAME PIC X(12) VALUE "CodeWithMee".
       01 WS-SUM  PIC 9(4)  VALUE 0.
       01 WS-I    PIC 9(2)  VALUE 0.
       PROCEDURE DIVISION.
           DISPLAY "Hello, " WS-NAME "!".
           PERFORM VARYING WS-I FROM 1 BY 1
               UNTIL WS-I > 5
               ADD WS-I TO WS-SUM
           END-PERFORM.
           DISPLAY "Sum of 1-5: " WS-SUM.
           STOP RUN.`,

    nasm: `; Welcome to the Assembly (NASM) sandbox!
; x86 (32-bit) Linux Assembly
; This is how computers REALLY work under the hood.

section .data
    msg db "Hello, CodeWithMee!", 10  ; 10 = newline
    len equ $ - msg

section .text
    global _start

_start:
    ; sys_write(stdout, msg, len)
    mov eax, 4          ; syscall: write
    mov ebx, 1          ; file descriptor: stdout
    mov ecx, msg        ; pointer to message
    mov edx, len        ; message length
    int 0x80            ; call kernel

    ; sys_exit(0)
    mov eax, 1          ; syscall: exit
    xor ebx, ebx        ; exit code: 0
    int 0x80            ; call kernel`,
  };

  // Monaco editor uses different language identifiers
  const monacoLanguageMap = {
    python: 'python', javascript: 'javascript', java: 'java',
    cpp: 'cpp', c: 'c', rust: 'rust', ruby: 'ruby', go: 'go',
    kotlin: 'kotlin', swift: 'swift', scala: 'scala', dart: 'dart',
    php: 'php', perl: 'perl', r: 'r', elixir: 'elixir',
    sqlite: 'sql', bash: 'shell', powershell: 'powershell',
    cobol: 'cobol', nasm: 'plaintext',
  };

  const getMonacoLanguage = (lang) => monacoLanguageMap[lang] || lang;

  // --- Smart Language Detection from Topic AND Pathway ---
  const detectLanguageFromContext = (pathwayStr, topicStr) => {
    // Combine pathway + topic for maximum matching accuracy
    const combined = `${pathwayStr || ''} ${topicStr || ''}`.toLowerCase();
    if (!combined.trim()) return null;

    // Direct pathway-level matches (most reliable)
    const pathwayLower = (pathwayStr || '').toLowerCase();
    
    // Match "learn Java" or "Java programming" but NOT "JavaScript"
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
    if (/\br\b programming|\brstudio\b/i.test(pathwayLower)) return 'r';
    if (/\belixir\b/i.test(pathwayLower)) return 'elixir';
    if (/\bbash\b|\bshell\b|\blinux\b/i.test(pathwayLower)) return 'bash';
    if (/\bcobol\b/i.test(pathwayLower)) return 'cobol';
    if (/\bassembly\b|\bnasm\b/i.test(pathwayLower)) return 'nasm';
    if (/\bperl\b/i.test(pathwayLower)) return 'perl';
    if (/\bpowershell\b/i.test(pathwayLower)) return 'powershell';
    if (/\bc programming|\bc language/i.test(pathwayLower)) return 'c';

    // Fall back to topic-level detection using the combined string
    const t = combined;
    if (/\b(sql|sqlite|database|query|queries|relational|mysql|postgres|nosql)\b/.test(t)) return 'sqlite';
    if (/\b(javascript|js|node\.?js|react|vue|angular|express|next\.?js|dom|ajax|fetch|json|typescript|npm|webpack|babel)\b/.test(t)) return 'javascript';
    if (/\b(python|django|flask|pandas|numpy|matplotlib|scipy|tensorflow|keras|pytorch|machine.?learning|data.?science|deep.?learning|jupyter|pip)\b/.test(t)) return 'python';
    if (/\b(java|spring|hibernate|maven|gradle|jvm|servlet|jdbc|swing|javafx|jdk|jre|intellij)\b/i.test(t) && !/javascript/i.test(t)) return 'java';
    if (/\b(c\+\+|cpp|stl|cmake|template|pointer|oop|object.?oriented|data.?structure|algorithm|competitive.?programming)\b/.test(t)) return 'cpp';
    if (/\b(c programming|c language|embedded|microcontroller|memory.?management|operating.?system)\b/.test(t)) return 'c';
    if (/\b(rust|cargo|ownership|borrowing|lifetimes|crate)\b/.test(t)) return 'rust';
    if (/\b(golang|goroutine|concurrency)\b/.test(t)) return 'go';
    if (/\b(ruby|rails|ruby.?on.?rails|sinatra|gem)\b/.test(t)) return 'ruby';
    if (/\b(php|laravel|wordpress|symfony|composer)\b/.test(t)) return 'php';
    if (/\b(kotlin|jetpack.?compose)\b/.test(t)) return 'kotlin';
    if (/\b(swift|ios|swiftui|xcode|uikit|apple)\b/.test(t)) return 'swift';
    if (/\b(scala|spark|akka|play.?framework)\b/.test(t)) return 'scala';
    if (/\b(dart|flutter|widget)\b/.test(t)) return 'dart';
    if (/\b(r programming|r language|rstudio|ggplot|tidyverse|statistics|statistical)\b/.test(t)) return 'r';
    if (/\b(elixir|phoenix|erlang|otp)\b/.test(t)) return 'elixir';
    if (/\b(perl|regex|regular.?expression|text.?processing)\b/.test(t)) return 'perl';
    if (/\b(bash|shell|linux|unix|command.?line|terminal|scripting|devops|docker|kubernetes|ci.?cd)\b/.test(t)) return 'bash';
    if (/\b(powershell|windows.?admin|active.?directory|azure)\b/.test(t)) return 'powershell';
    if (/\b(assembly|nasm|x86|low.?level|registers|syscall)\b/.test(t)) return 'nasm';
    if (/\b(cobol|mainframe|legacy|banking.?system)\b/.test(t)) return 'cobol';
    if (/\b(html|css|web|frontend|front.?end|backend|back.?end|api|rest|graphql)\b/.test(t)) return 'javascript';

    return null;
  };

  useEffect(() => {
    const title = topic || 'General Sandbox';
    setPageTitle(title);

    // Auto-detect language from pathway+topic context
    const detected = detectLanguageFromContext(pathwayParam, topic);
    if (detected) {
      setLanguage(detected);
    }

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

  // --- Load YouTube IFrame API script ---
  useEffect(() => {
    if (window.YT && window.YT.Player) return; // Already loaded
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript.parentNode.insertBefore(tag, firstScript);
  }, []);

  // --- Save video progress to backend ---
  const saveVideoProgress = useCallback(async (vid, time, dur) => {
    if (!token || !vid || time === undefined) return;
    try {
      await axios.put('http://localhost:5001/api/user/video-progress', {
        videoId: vid,
        timestamp: Math.floor(time),
        duration: Math.floor(dur || 0),
        topic: topic || '',
        pathway: pathwayParam || '',
      }, { headers: { 'x-auth-token': token } });
    } catch (err) {
      console.error('Failed to save video progress', err);
    }
  }, [token, topic, pathwayParam]);

  // --- Fetch saved progress for a video ---
  const fetchVideoProgress = useCallback(async (vid) => {
    if (!token || !vid) return null;
    try {
      const res = await axios.get(`http://localhost:5001/api/user/video-progress/${vid}`, {
        headers: { 'x-auth-token': token }
      });
      return res.data;
    } catch (err) {
      console.error('Failed to fetch video progress', err);
      return null;
    }
  }, [token]);

  // --- Initialize YouTube Player when videoId is available ---
  useEffect(() => {
    if (!videoId || isVideoLoading) return;

    const initPlayer = async () => {
      // Fetch saved progress first
      const progress = await fetchVideoProgress(videoId);
      const startSeconds = progress?.timestamp || 0;
      const totalDuration = progress?.duration || 0;

      if (startSeconds > 5 && totalDuration > 0) {
        // There's meaningful saved progress — show resume overlay
        setSavedProgress({ timestamp: startSeconds, duration: totalDuration });
        setShowResumeOverlay(true);
        setVideoProgressPercent(Math.min((startSeconds / totalDuration) * 100, 100));
      } else {
        setSavedProgress(null);
        setShowResumeOverlay(false);
        setVideoProgressPercent(0);
      }

      // Wait for the YT API to load
      const waitForYT = () => new Promise((resolve) => {
        if (window.YT && window.YT.Player) return resolve();
        window.onYouTubeIframeAPIReady = resolve;
      });
      await waitForYT();

      // Destroy existing player if any
      if (ytPlayerRef.current) {
        try { ytPlayerRef.current.destroy(); } catch (e) {}
        ytPlayerRef.current = null;
      }

      // Clear any existing progress interval
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }

      // Create new player
      if (!ytPlayerContainerRef.current) return;

      ytPlayerRef.current = new window.YT.Player(ytPlayerContainerRef.current, {
        videoId: videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          rel: 0,
          modestbranding: 1,
          start: 0, // Always start at 0, the resume overlay handles seeking
        },
        events: {
          onReady: (event) => {
            // Player is ready
          },
          onStateChange: (event) => {
            const player = event.target;
            if (event.data === window.YT.PlayerState.PLAYING) {
              // Start progress tracking every 5 seconds
              if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
              progressIntervalRef.current = setInterval(() => {
                try {
                  const currentTime = player.getCurrentTime();
                  const duration = player.getDuration();
                  if (currentTime && duration) {
                    setVideoProgressPercent(Math.min((currentTime / duration) * 100, 100));
                    saveVideoProgress(videoId, currentTime, duration);
                  }
                } catch (e) {}
              }, 5000);
            } else if (event.data === window.YT.PlayerState.PAUSED) {
              // Save progress on pause
              if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
              }
              try {
                const currentTime = player.getCurrentTime();
                const duration = player.getDuration();
                if (currentTime && duration) {
                  setVideoProgressPercent(Math.min((currentTime / duration) * 100, 100));
                  saveVideoProgress(videoId, currentTime, duration);
                }
              } catch (e) {}
            } else if (event.data === window.YT.PlayerState.ENDED) {
              // Video ended - save as completed
              if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
              }
              try {
                const duration = player.getDuration();
                setVideoProgressPercent(100);
                saveVideoProgress(videoId, duration, duration);
              } catch (e) {}
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

  // --- Resume / Start Fresh handlers ---
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
    setVideoProgressPercent(0);
    if (ytPlayerRef.current) {
      ytPlayerRef.current.seekTo(0, true);
    }
  };

  // --- Format time for display ---
  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  useEffect(() => {
    const fetchData = async () => {
      if (!token) return;
      if (youtubeQuery) {
        setIsVideoLoading(true);
        try {
          const res = await axios.get(`http://localhost:5001/api/youtube/search?q=${encodeURIComponent(youtubeQuery)}`);
          const vid = res.data?.videoId || '';
          setVideoId(vid);
        } catch (err) {
          console.error('Failed to fetch video', err);
          setVideoId('');
        } finally {
          setIsVideoLoading(false);
        }
      } else {
        setIsVideoLoading(false);
      }
      // Fetch structured sandbox chat history
      try {
        const res = await axios.get('http://localhost:5001/api/ai/sandbox-history', { headers: { 'x-auth-token': token } });
        setAllChats(res.data.chatsByPathway || {});
        setAvailableRoadmaps(res.data.roadmaps || []);
        // Load chat for current pathway+chapter
        const pw = pathwayParam || 'General';
        const ch = topic || 'General';
        setSelectedPathway(pw);
        setSelectedChapter(ch);
        const chapterChats = res.data.chatsByPathway?.[pw]?.[ch] || [];
        const history = chapterChats.flatMap(conv => [{ sender: 'user', message: conv.prompt }, { sender: 'ai', message: parseMarkdown(conv.response) }]);
        setChatHistory(history);
      } catch (err) {
        console.error('Failed to fetch chat history', err);
      }
    };
    fetchData();
  }, [youtubeQuery, token, pathwayParam, topic]);

  const handleRunCode = async () => {
    setIsCodeRunning(true);
    setOutput('Running code...');
    try {
      const res = await axios.post('http://localhost:5001/api/code/run', { code, language }, { headers: { 'x-auth-token': token } });
      setOutput(res.data.output || 'Code executed with no output.');
    } catch (err) {
      setOutput(err.response?.data?.error || 'Failed to run code.');
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
      const res = await axios.post('http://localhost:5001/api/ai/chat', {
        question: currentInput,
        code,
        pathway: selectedPathway,
        chapter: selectedChapter,
      }, { headers: { 'x-auth-token': token } });
      const formattedAnswer = parseMarkdown(res.data.answer);
      setChatHistory([...newHistory, { sender: 'ai', message: formattedAnswer }]);

      // Update the local allChats cache so switching pathways/chapters works correctly
      setAllChats(prev => {
        const updated = { ...prev };
        if (!updated[selectedPathway]) updated[selectedPathway] = {};
        if (!updated[selectedPathway][selectedChapter]) updated[selectedPathway][selectedChapter] = [];
        updated[selectedPathway][selectedChapter] = [
          ...updated[selectedPathway][selectedChapter],
          { prompt: currentInput, response: res.data.answer, timestamp: new Date().toISOString() }
        ];
        return updated;
      });
    } catch (err) {
      setChatHistory([...newHistory, { sender: 'ai', message: "Sorry, I'm having trouble connecting right now." }]);
    }
    setIsAiLoading(false);
  };

  // --- Switch chat context (pathway/chapter selectors) ---
  const handlePathwaySwitch = (pw) => {
    setSelectedPathway(pw);
    // Auto-select first chapter of this pathway
    const roadmap = availableRoadmaps.find(r => r.title === pw);
    const firstChapter = roadmap?.chapters?.[0] || 'General';
    setSelectedChapter(firstChapter);
    const chapterChats = allChats?.[pw]?.[firstChapter] || [];
    const history = chapterChats.flatMap(conv => [{ sender: 'user', message: conv.prompt }, { sender: 'ai', message: parseMarkdown(conv.response) }]);
    setChatHistory(history);
  };

  const handleChapterSwitch = (ch) => {
    setSelectedChapter(ch);
    const chapterChats = allChats?.[selectedPathway]?.[ch] || [];
    const history = chapterChats.flatMap(conv => [{ sender: 'user', message: conv.prompt }, { sender: 'ai', message: parseMarkdown(conv.response) }]);
    setChatHistory(history);
  };

  // --- Clear chat history for current chapter ---
  const handleClearChat = async () => {
    if (!window.confirm(`Clear all AI chat for "${selectedChapter}" in "${selectedPathway}"?`)) return;
    try {
      await axios.delete(`http://localhost:5001/api/ai/sandbox-history?pathway=${encodeURIComponent(selectedPathway)}&chapter=${encodeURIComponent(selectedChapter)}`, {
        headers: { 'x-auth-token': token },
      });
      setChatHistory([]);
      // Update local cache
      setAllChats(prev => {
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

  // --- Debug button handler ---
  const handleDebug = async () => {
    if (isDebugging) return;
    setIsDebugging(true);
    try {
      const res = await axios.post('http://localhost:5001/api/ai/debug', {
        code,
        output,
        language,
        topic: selectedChapter || topic || 'General',
      }, { headers: { 'x-auth-token': token } });
      if (res.data.correctedCode) {
        setCode(res.data.correctedCode);
        setOutput('✅ Debug complete! Check the code editor for corrections and explanations in comments.');
      }
    } catch (err) {
      setOutput('❌ Debug failed: ' + (err.response?.data?.error || 'Could not reach AI.'));
    }
    setIsDebugging(false);
  };

  // --- Resizing Logic with rAF throttling ---
  const isDraggingRef = useRef(null);

  const handleMouseDown = (dividerType) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = dividerType;
    setIsDragging(dividerType);
    document.body.style.cursor = dividerType === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = null;
    setIsDragging(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      pendingMoveRef.current = null;
    }

    // Trigger Monaco layout after drag ends
    if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
    layoutTimerRef.current = setTimeout(() => {
      try { monacoEditorRef.current?.layout(); } catch (e) {}
    }, 50);
  }, []);

  const handleMouseMove = useCallback((e) => {
    const dragType = isDraggingRef.current;
    if (!dragType) return;

    pendingMoveRef.current = { clientX: e.clientX, clientY: e.clientY, dragType };

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
        }
      });
    }
  }, []);

  useEffect(() => {
    // Always attach to document for reliable drag tracking
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [handleMouseMove, handleMouseUp]);

  // Monaco onMount: capture editor instance and set up manual layout observer
  const handleEditorMount = (editor, monaco) => {
    monacoEditorRef.current = editor;
    // Initial layout
    setTimeout(() => {
      try { editor.layout(); } catch (e) {}
    }, 100);

    // Observe the editor container for size changes (replaces automaticLayout)
    if (editorContainerRef.current) {
      const ro = new ResizeObserver(() => {
        if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
        layoutTimerRef.current = setTimeout(() => {
          try { editor.layout(); } catch (e) {}
        }, 50);
      });
      ro.observe(editorContainerRef.current);
    }
  };

  return (
    <div className="sandbox-page-container">
      {/* Transparent overlay during drag to prevent iframes from stealing mouse events */}
      {isDragging && (
        <div
          className="drag-overlay"
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
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
                {/* Resume Overlay */}
                {showResumeOverlay && savedProgress && (
                  <div className="video-resume-overlay">
                    <div className="resume-overlay-content">
                      <div className="resume-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/>
                          <polyline points="12 6 12 12 16 14"/>
                        </svg>
                      </div>
                      <p className="resume-text">Continue from <strong>{formatTime(savedProgress.timestamp)}</strong>?</p>
                      <div className="resume-actions">
                        <button className="resume-btn" onClick={handleResumeVideo}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
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
          <div className="resize-handle horizontal" onMouseDown={handleMouseDown('left')}>
            <div className="handle-dots">
              <span /><span /><span />
            </div>
          </div>
          <div className="ai-assistant" style={{ height: `calc(${100 - leftHorizontalSplit}% - 10px)` }}>
            <div className="chat-context-bar">
              <select
                className="chat-selector"
                value={selectedPathway}
                onChange={(e) => handlePathwaySwitch(e.target.value)}
              >
                <option value="General">General</option>
                {availableRoadmaps.map((r, i) => (
                  <option key={i} value={r.title}>{r.title}</option>
                ))}
              </select>
              <select
                className="chat-selector"
                value={selectedChapter}
                onChange={(e) => handleChapterSwitch(e.target.value)}
              >
                <option value="General">General</option>
                {(availableRoadmaps.find(r => r.title === selectedPathway)?.chapters || []).map((ch, i) => (
                  <option key={i} value={ch}>{ch}</option>
                ))}
              </select>
              <button className="clear-chat-btn" onClick={handleClearChat} title="Clear chat for this chapter"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
            </div>
            <div className="chat-history" ref={chatHistoryRef}>
              {chatHistory.length === 0 && (
                <div className="chat-empty-state">No chat history for this chapter. Ask Mee a question!</div>
              )}
              {chatHistory.map((chat, index) => (
                <div key={index} className={`chat-message ${chat.sender}`}>
                  <div dangerouslySetInnerHTML={{ __html: chat.message }} />
                </div>
              ))}
              {isAiLoading && <div className="chat-message ai"><div className="thinking-indicator">Mee is thinking...</div></div>}
            </div>
            <form className="chat-input-form" onSubmit={handleAskAI}>
              <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Ask Mee a question..." disabled={isAiLoading} />
              <button type="submit" disabled={isAiLoading}>Send</button>
              <button type="button" className="debug-btn" onClick={handleDebug} disabled={isDebugging} title="Debug: Analyze errors and fix code">{isDebugging ? <span className="debug-spinner">...</span> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3.003 3.003 0 116 0v1"></path><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6"></path><path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M6 17H3M21 5c0 2.1-1.6 3.8-3.53 4M18 13h4M18 17h3"></path></svg>}</button>
            </form>
          </div>
        </div>
        <div className="resize-handle vertical" onMouseDown={handleMouseDown('vertical')}>
          <div className="handle-dots">
            <span /><span /><span />
          </div>
        </div>
        <div className="right-pane" style={{ width: `calc(${100 - verticalSplit}% - 10px)` }}>
          <div className="editor-pane" ref={editorContainerRef} style={{ height: `calc(${rightHorizontalSplit}% - 10px)` }}>
            <div className="editor-header">
              <CustomDropdown options={languageOptions} selected={languageOptions.find(opt => opt.value === language)?.label || 'Select'} onSelect={(option) => setLanguage(option.value)} />
              <button onClick={handleRunCode} className="run-button" disabled={isCodeRunning}>{isCodeRunning ? 'Running...' : 'Run Code'}</button>
            </div>
            <Editor
              height="calc(100% - 40px)"
              language={getMonacoLanguage(language)}
              value={code}
              theme="vs-dark"
              onChange={(value) => setCode(value || '')}
              onMount={handleEditorMount}
              options={{
                fontSize: 16,
                minimap: { enabled: false },
                automaticLayout: false,
                scrollBeyondLastLine: false,
                wordWrap: 'on'
              }}
            />
          </div>
          <div className="resize-handle horizontal" onMouseDown={handleMouseDown('right')}>
            <div className="handle-dots">
              <span /><span /><span />
            </div>
          </div>
          <div className="terminal-pane" style={{ height: `calc(${100 - rightHorizontalSplit}% - 10px)` }}>
            <h3>Terminal</h3>
            <pre className="output-text">{output || 'Click "Run Code" to see the output here...'}</pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sandbox;
