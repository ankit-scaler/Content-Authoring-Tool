# Previous Tool Comprehensive Audit & Engineering Fixes
## Analysis of Real-World Testing Failures (Review Log: May 4–6, 2026)

---

## 1. Executive Summary: What Broke in the Previous Tool?

The real-world testing log from May 4–6 reveals that the previous tool failed because it operated as an **unconstrained generic chatbot** rather than a **domain-aware technical authoring platform**. 

The failures fall into **7 Critical Architectural Gaps**:
1. **SQL Dialect Confusion:** Hallucinating generic MySQL syntax when classes required Google BigQuery (syntax broke when copied to BigQuery; lacked `zomato.orders` dataset prefixing).
2. **Dataset Detachment:** Ignored the bound dataset (e.g., Zomato, HR) and generated generic queries with fake columns.
3. **Agenda & Instruction Drift:** Submerged agenda keywords into text walls and ignored user prompts to use specific datasets.
4. **Lazy Instructor Notes:** Told the instructor to *"prepare an example by yourself"* instead of providing the exact delivery script and syntax divergence alerts.
5. **Missing Image Previews:** Outputted raw link URLs instead of rendering inline visual assets (CloudFront / Scaler admin assets).
6. **Missing Query Breakdowns:** Failed to provide step-by-step clause-by-clause query translations for students and Remote Instructors (RIs).
7. **Disorganized Repository:** Mixed SQL, Python, and DAV scripts in one giant unorganized bucket.

---

## 2. Comprehensive Issue-by-Issue Resolution Matrix

| # | Reported Issue / Test Log | Severity | Root Cause in Old Tool | Architectural Fix in New System |
| :-: | :--- | :---: | :--- | :--- |
| **1** | **BigQuery vs. MySQL Confusion** (Items 4, 12, 15, 25) | **CRITICAL** | LLM defaulted to generic MySQL. Queries failed in BigQuery; invalid DDL commands in beginner class; lacked `dataset.table` prefixes. | **SQL Dialect Selector & Dialect Validator Engine:**<br>• SME selects target dialect (`BigQuery` vs `MySQL`) via cascading dropdown.<br>• Automatic schema prefixing (e.g., `FROM zomato.orders`).<br>• Banned commands filter (e.g., flags `ALL`/`ANY` in BigQuery). |
| **2** | **Dataset Alignment & Schema Definition** (Items 5, 6, 10, 11, 13, 16, 18) | **CRITICAL** | LLM hallucinated arbitrary table names; omitted dataset descriptions; ignored Zomato/HR assignments. | **Dataset Binding & Schema Definition Store:**<br>• Explicit Dataset Attachment section (Schema definition + 100KB sample CSV cap).<br>• Multi-class dataset persistence (Lectures 1–6 use Zomato; Lecture 7 introduces HR).<br>• If no dataset uploaded, AI generates and links downloadable sample CSV for live testing. |
| **3** | **Agenda Adherence & Keyword Submerging** (Items 14, 22, 23) | **HIGH** | LLM treated agenda items as optional themes, burying keywords in unstructured paragraphs without business context. | **Deterministic Agenda Card Checklist:**<br>• Every agenda item maps 1:1 to a discrete card.<br>• Bolded keyword placement + business impact metric ("so what?").<br>• Strict negative prompt constraint against ignoring SME instructions. |
| **4** | **"Lazy" Instructor Notes** (Item 17) | **HIGH** | LLM generated placeholder hints: *"Instructor should prepare an example."* | **Structured Cue Card (CC) Engine:**<br>• Zero-lazy policy: AI writes the exact live example and delivery hints.<br>• Includes platform-specific divergence alerts (e.g., *"Notice: `ALL`/`ANY` syntax will fail in BigQuery; demonstrate conceptual equivalent with provided code"*). |
| **5** | **Visual Asset & Image Previews** (Items 9, 20, May 5 #1, #2) | **HIGH** | Only generated basic Mermaid flowcharts; printed raw image links without rendering previews. | **Multimodal Asset & Inline Preview Renderer:**<br>• Full markdown preview of CloudFront & Scaler public-asset URLs (`scaler.com/admin/add_files/public-asset/`).<br>• Dual visual support: Mermaid diagrams + AI Canvas visual illustrations. |
| **6** | **Query Breakdown & Explanation** (Item 21) | **MEDIUM** | Dumped raw queries without clause-by-clause walkthrough for Remote Instructors (RIs). | **Clause-by-Clause Translation Bridge:**<br>• Every query broken down by `SELECT`, `FROM`, `WHERE`, `GROUP BY`.<br>• Explains what the query asks in plain business English. |
| **7** | **Module Bifurcation & Code Tag Bug** (May 4 #3, May 6 #1, #2) | **MEDIUM** | Scripts dumped into one bucket; UI showed `"python"` language tags for SQL scripts. | **Hierarchical Module Catalog & Dynamic Highlighter:**<br>• Rigid grouping: `Program -> Track -> Module (SQL / Python / DAV 1,2,3)`.<br>• Language tag auto-locks to `sql` when track is SQL. |

---

## 3. Deep-Dive Solutions for the Top 4 Failure Modes

### Gap 1: The SQL Dialect Engine (BigQuery vs. MySQL)

#### The Problem:
In Google BigQuery, querying tables requires dataset prefixing (`zomato.orders`), and certain operators (like `ALL`, `ANY`) do not exist. In MySQL, table names are unprefixed (`orders`), and syntax rules differ. The old tool randomly generated MySQL syntax, causing queries to break when copied into BigQuery.

#### The New Implementation:
1. **Dialect Selector at Class Level:**
   - Dropdown options: `Google BigQuery (Standard SQL)` | `MySQL 8.0`.
   - The dialect choice sets the code generation persona and syntax linter.
2. **Mandatory Dataset Prefixing in BigQuery Mode:**
   - In BigQuery mode, all table references are automatically written as `dataset_name.table_name`:
   ```sql
   -- Correct BigQuery Query generated by new engine:
   SELECT 
       order_id, 
       order_status, 
       final_amount
   FROM `zomato.orders`
   WHERE order_status = 'COMPLETED'
     AND final_amount > 500;
   ```
3. **Dialect Divergence Alerts in Instructor Notes:**
   - If an instructor teaches a concept that behaves differently across engines, the Cue Card explicitly notes:
     > **[Instructor Note — Dialect Alert]:**  
     > *"In MySQL, you can use the `ANY` operator. However, in BigQuery, `ANY` is not supported. Use the `IN` subquery syntax provided above when demonstrating live in BigQuery console."*

---

### Gap 2: Dataset Binding & Schema Definition Store

#### The Problem:
The old tool didn't know what columns existed in the Zomato or HR datasets, so it hallucinated column names (e.g., `zomato.food_price` instead of `final_amount`), making queries unexecutable.

#### The New Implementation:
1. **Explicit Dataset Ingestion Box in SME Inputs:**
   - SME can either:
     - **Option A:** Select from the Pre-approved Curriculum Datasets (e.g., `Zomato Orders Dataset`, `HR Employee Dataset`, `Swiggy Delivery Dataset`).
     - **Option B:** Upload a Custom Dataset schema / sample CSV (with a strict **100KB size cap** to prevent context window exhaustion).
2. **Cross-Class Dataset Continuity (Lectures 1 to 6 vs 7):**
   - Lectures 1 to 6: System auto-binds to `Zomato`. In Lecture 1, Card 4 introduces the **Dataset Schema Description** (Table structure, column data types, row count).
   - Lecture 7: System detects dataset transition to `HR` and automatically generates the new dataset introduction card.
3. **Automated Fallback Download Links:**
   - If no dataset is provided by the SME, the AI generates a synthetic schema AND provides a **direct download link** in the script header so the instructor and RIs can download the sample CSV and run queries locally before class.

---

### Gap 3: Eradicating "Lazy" Instructor Notes (Cue Cards / CC)

#### The Problem:
The old tool generated lazy instructions like:  
*“Instructor Note: Please prepare an example of update anomaly on your own.”*  
This defeats the entire purpose of an AI authoring assistant.

#### The New Implementation:
Instructor notes must follow the **Actionable Cue Card (CC) Standard**:
```markdown
> **[Instructor Cue Card — Delivery Staging]:**  
> 1. **Visual Asset Link:** Open the Zomato schema diagram at: `https://assets.scaler.com/public/zomato_schema_v2.png`  
> 2. **Dialect Alert:** We are executing in Google BigQuery. Remind students that table names must include the dataset prefix: `zomato.orders`.  
> 3. **Common Student Mistake:** Students will try writing `SELECT *` without a limit. Remind them: BigQuery charges per bytes scanned! Always add `LIMIT 100` during live demos.
```

---

### Gap 4: Multimodal Asset & Image Previews

#### The Problem:
Displaying raw Markdown links like `[click here to view schema](https://...)` forces the instructor to open multiple browser tabs while teaching.

#### The New Implementation:
1. **Inline Image Previews:**
   - Renders image assets directly inside the card view using authenticated Scaler public-asset URLs or CloudFront CDNs:
     ```markdown
     ![Zomato Order Schema Preview](https://www.scaler.com/admin/add_files/public-asset/zomato_erd_v1.png)
     ```
2. **Dual Visual Strategy:**
   - **Mermaid.js:** Used for dynamic logic flows and execution trees ($\le 7$ nodes).
   - **Static Image Previews:** Used for high-fidelity Database ER diagrams, production architecture maps, and UI mockups.

---

## 4. Input Form Upgrades Derived From This Audit

We have updated the SME Input Console specifications with these 4 explicit fields:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      REFINED SME INPUT CONSOLE                         │
├────────────────────────────────────────────────────────────────────────┤
│ 1. SQL Dialect:            [ Google BigQuery ▼ ]  (or MySQL 8.0)       │
│                                                                        │
│ 2. Bound Dataset:          [ Zomato Orders Dataset (Lec 1-6) ▼ ]       │
│    Schema Upload (Optional): [ Drag & Drop CSV / Schema (Max 100KB) ]  │
│                                                                        │
│ 3. Script Ingestion Type:  [ New AI Draft ] / [ Upload Docx / PDF Ref] │
│                                                                        │
│ 4. Visual Asset Type:      [ [✓] Mermaid Flowchart  [✓] Image Preview ]│
└────────────────────────────────────────────────────────────────────────┘
```

This guarantees that every single pain point reported in the May 4–6 simulation review is permanently resolved.
