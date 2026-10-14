# Beginner Scaffolding & Code Pacing Engine
## Protecting Beginners from Code Overload & Curriculum-Aligned Syntax Gating

---

## 1. Problem Diagnosis: The "Class 1 Code Dump" Trap

In typical AI generators, when an instructor asks for a lecture script on a topic like "Databases", the AI makes a fatal mistake:

```
               THE WRONG APPROACH (WHAT FAILED PREVIOUSLY)
  ┌─────────────────────────────────────────────────────────────────┐
  │ SME selects "Beginner Track" for Class 1 (Intro to DBMS)        │
  │                                                                 │
  │ AI Output:                                                      │
  │ • Dumps 40 lines of complete Python/psycopg2 connection code   │
  │ • Shows raw connection strings, pool handlers, try/except blocks│
  │ • Introduces nested SQL queries and primary key DDL syntax      │
  └────────────────────────────────┬────────────────────────────────┘
                                   │
                                   ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ Result:                                                         │
  │ • Cognitive overload! The beginner panics and gets intimidated. │
  │ • Wastes 40 mins debugging driver imports instead of learning   │
  │   what a database actually is.                                  │
  └─────────────────────────────────────────────────────────────────┘
```

When an SME selects the **Beginner track**, the learner knows **virtually nothing about the topic**. Dumping production-grade, multi-file code in Class 1 destroys intuition and causes high student drop-off.

---

## 2. The Core Solution: The 3-Filter Code Gating Mechanism

Before the Writer Agent outputs even a single line of code in any script, it passes through **Three Strict Filters**:

```
                              THE 3-FILTER CODE GATE
  ┌───────────────────────┐   ┌────────────────────────┐   ┌───────────────────────┐
  │ 1. AUDIENCE LEVEL     │   │ 2. CLASS AGENDA & SEQ  │   │ 3. CODE:CONTENT RATIO │
  │    (Beginner Filter)  │ ─►│    (Curriculum Gate)   │ ─►│    (SME Slider Cap)   │
  └───────────────────────┘   └────────────────────────┘   └───────────────────────┘
              │                           │                            │
              ▼                           ▼                            ▼
   Bans complex boilerplate;   Checks Class 1 goals;        Caps total lines & card
   enforces 3-line max snippets enforces plain English      slots allocated to code
```

---

## 3. Filter 1: The Beginner Scaffolding Rules

When `Audience Level == Beginner`:

### 1. The "Zero-Boilerplate" Rule
- **Strictly Banned in Class 1 for Beginners:**
  - No database connection drivers (e.g., `mysql.connector`, `psycopg2`, `mongoose.connect()`).
  - No environment variables, port configurations, or connection pools.
  - No nested subqueries, joins, or complex DDL scripts.
- **Why:** Beginners do not yet know *why* a database exists; showing them a port `5432` or a TCP socket handshake creates pure confusion.

### 2. The "3-Line Syntax Ceiling"
In introductory classes for Beginners, code snippets are strictly limited to **1 to 3 lines of intuitive commands**:
```sql
-- What Beginners see in Class 1:
SELECT student_name, room_no 
FROM students 
WHERE room_no = 'B-204';
```


### 3. The 1-to-1 Plain English Translation Bridge
Every line of code shown to a Beginner must be translated directly into plain conversational English:
> *"Notice how simple this is:*  
> *• `SELECT student_name`: Tell the computer: 'Give me the name column.'*  
> *• `FROM students`: Tell the computer: 'Look inside the students table.'*  
> *• `WHERE room_no = 'B-204'`: Tell the computer: 'Only pick people who live in room B-204.'*  
> *It reads almost like a normal English sentence!"*

---

## 4. Filter 2: Curriculum-Driven Code Pacing (Class Sequence Awareness)

The engine checks the class sequence within the locked module plan to determine code maturity:

| Class Sequence | Pedagogical Purpose | Allowed Code Depth for Beginners |
| :---: | :--- | :--- |
| **Class 1 (Intro)** | Why files fail $\to$ Relational mental models $\to$ Table anatomy | **0% Production Code.**<br>Only conceptual pseudocode & single 1-line query demonstrations. |
| **Class 2 (Basic Syntax)** | First SQL queries $\to$ Filtering $\to$ Sorting | **10–15 Lines Max.**<br>Isolated single-table queries (`SELECT`, `WHERE`, `ORDER BY`). |
| **Class 3 (Relationships)** | Multi-table connections $\to$ Keys | **2-Table Queries.**<br>Simple `INNER JOIN` demonstrating entity connections. |
| **Class 4–8 (Applied)** | Aggregations, Group By, Subqueries | **Realistic Queries.**<br>Real multi-table business questions. |
| **Class 9+ (Production/Lab)**| Indexes, Transactions, Driver connection | **Full Codebase.**<br>Live scripts connecting backend APIs to the database. |

---

## 5. Filter 3: SME-Controlled Code vs. Content Ratio

The SME controls the balance using an interactive slider:

```
[Theory / Content: 80%]  ◄───────────●────────►  [Live Code: 20%]
```

### How the Engine Executes the Ratio for Beginners:

#### Scenario A: SME selects 80% Theory / 20% Code (Recommended for Class 1)
- **12 Cards:** Everyday analogies, the society gate register story, quantified file failures, 2-table visual comparison, interactive quizzes.
- **2 Cards:** Micro-syntax demo (1-line `SELECT` query) + plain English translation bridge.
- **Zero confusing boilerplate.**

#### Scenario B: SME selects 50% Theory / 50% Code (Classes 2 to 5)
- **8 Cards:** Concept explanation, why a specific clause exists, edge-case breakdown.
- **6 Cards:** Live step-by-step query building + execution trace + expected table output.

#### Scenario C: SME selects 20% Theory / 80% Code (Lab / Practice Sessions)
- **3 Cards:** Quick problem setup & requirements recap.
- **11 Cards:** Hands-on query writing, trying queries in terminal, fixing deliberate syntax errors, checking query runtimes.

---

## 6. Reviewer Agent "Beginner Cognitive Safety" Audit

Before an SME receives the script for review, the **Reviewer Agent (Beginner Persona Lens)** runs this deterministic checklist:

```python
def audit_beginner_code(script_cards, class_metadata):
    if class_metadata.audience_level == "Beginner" and class_metadata.class_sequence == 1:
        for card in script_cards:
            # Check 1: Boilerplate detection
            if any(term in card.content for term in ["connect(", "5432", "try {", "catch", "import psycopg2"]):
                return "FAIL: Class 1 Beginner script contains raw connection boilerplate. Replace with conceptual query."
            
            # Check 2: Snippet length check
            for code_block in card.code_blocks:
                if len(code_block.lines) > 5:
                    return f"FAIL: Code block in Card {card.id} has {len(code_block.lines)} lines. Max allowed for Class 1 Beginner is 4 lines."
                    
            # Check 3: Plain English translation check
            if card.has_code and not card.has_plain_english_breakdown:
                return f"FAIL: Card {card.id} has code but lacks line-by-line plain English translation."
                
    return "PASS"
```

---

## 7. Summary
By combining:
1. **Audience-Aware Scaffolding** (Zero boilerplate for beginners),
2. **Curriculum Pacing** (Class 1 = concepts & 1-line queries; Class 6+ = full code), and
3. **SME Ratio Slider** (Precise theory vs. code allocation),

the platform ensures that beginner scripts are **welcoming, crystal-clear, and completely intimidation-free.**
