# Il-Malti, MQF 1

A small site for Saturday lessons. It is plain HTML, CSS, and JavaScript, so it can sit on GitHub Pages, Netlify, or Vercel with no server to run.

Scores stay in the browser. A later try never replaces a better one.

## Preview

Do not open `index.html` from the desktop. The browser will block the lesson files.

From this folder:

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765`.

## Stars

| Stars | Score |
| --- | --- |
| 1 | 60% |
| 2 | 80% |
| 3 | 100% |

Cards are practice. Choices, blanks, reading, translation, and revision are scored when the section is finished.

Capitals and extra spaces are ignored. `ħ` and `ġ` still count, so `h` does not pass for `ħ`. The answer fields are marked as Maltese or English so the keyboard can follow, if that keyboard is installed.

There is no audio.

## Reference

The Reference tab is for reading, not for a score. On the home page it sits under the lessons. Lessons 1, 2, and 3, the alphabet, and the article follow the class notes. The reference also has the days, the months, the numbers, everyday phrases, prepositions, and particles. Edit `data/reference.json` to change that wording.

## Add a lesson on Saturday

1. Copy `data/lesson-2.json` to `data/lesson-3.json` (or the next number).
2. Set `lesson_id`, `title`, and `"status": "active"`.
3. Replace the vocabulary, choices, blanks, reading, and revision.
4. In `data/index.json`, point that lesson at the new file and set it to `"active"`. Add the week after as `"coming_soon"`. A coming-soon row does not need a file.
5. Preview every section once.
6. Ask a Maltese speaker to read the new sentences before class.

Lesson 1 should keep `"revision": []`. From lesson 2 on, `revision` is a list. Each item has `from_lesson` and `type`.

A choice (`"type": "mcq"`):

```json
{
  "from_lesson": 1,
  "type": "mcq",
  "question": "How do you say “Good morning”?",
  "options": ["Bonġu", "Bonswa", "Ċaw"],
  "answer": "Bonġu"
}
```

A blank (`"type": "fib"`). Put `___` where the word goes:

```json
{
  "from_lesson": 1,
  "type": "fib",
  "sentence": "Luca: ___",
  "hint": "How are you?",
  "answer": "Kif inti?"
}
```

Optional extras, safe to leave out:

- `answers` on a blank: other replies that should also pass, such as `"omm"` and `"ommi"`.
- `accept_english` and `accept_maltese` on a vocabulary card, for the translation tab only. The card still shows `english` and `maltese`.

The same keys are used in the lesson body: `vocabulary`, `multiple_choice`, `fill_in_blank`, and `comprehension` (`text` plus `questions`).

If a required key is missing, the browser console names the lesson.

## Class sheet (optional)

Leave `leaderboardUrl` in `data/config.json` empty and nothing is sent.

To share scores, deploy a Google Apps Script web app (execute as yourself, anyone can access) and paste its `https://` URL into `leaderboardUrl`. The page sends plain text, which avoids the usual browser block on this kind of request:

```javascript
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);
  sheet.appendRow([
    new Date(),
    data.nickname,
    data.lessonId,
    data.lessonTitle,
    data.section,
    data.percent,
    data.stars,
    data.completedAt
  ]);
  return ContentService.createTextOutput("ok");
}
```

A classmate types a first name or nickname. The sheet receives that name, the lesson, the section, the percent, the stars, and the time. It does not receive an account or an email address.

## A saved record (optional)

Lessons work with no account. Scores stay in the browser either way.

When Supabase is connected, finishing a scored section offers a record. The person can close it. A record is created only after they enter a first name, a last name, and an email, and tick the notice. The notice says the name, email, and scores are kept only to track progress. The database refuses a learner row unless that acceptance is true, and it stores the time they accepted.

Progress then draws a graph from the saved attempts. Deleting a record copies the person and their scores into an `archive` schema and removes them from the active tables. The website cannot read the archive.

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. In Authentication → Providers, turn on Anonymous sign-ins.
4. Put the project URL and the anon key in `data/config.json`:

```json
{
  "leaderboardUrl": "",
  "supabaseUrl": "https://YOUR-PROJECT.supabase.co",
  "supabaseAnonKey": "YOUR-ANON-KEY"
}
```

Leave either field empty and the record form stays hidden.

## A saved record (optional)

Lessons work with no account. Scores stay in the browser either way.

When Supabase is connected, finishing a scored section offers a record. The person can close it. A record is created only after they enter a first name, a last name, and an email, and tick the notice. The notice says the name, email, and scores are kept only to track progress. The database refuses a learner row unless that acceptance is true, and it stores the time they accepted.

Progress then draws a graph from the saved attempts. Deleting a record copies the person and their scores into an `archive` schema and removes them from the active tables. The website cannot read the archive.

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. In Authentication → Providers, turn on Anonymous sign-ins.
4. Put the project URL and the anon key in `data/config.json`:

```json
{
  "leaderboardUrl": "",
  "supabaseUrl": "https://YOUR-PROJECT.supabase.co",
  "supabaseAnonKey": "YOUR-ANON-KEY"
}
```

Leave either field empty and the record form stays hidden.

## Publish

Upload this folder as it is. Paths are relative, so a project site such as `username.github.io/maltese-helper/` still finds the lessons. `.nojekyll` is included so GitHub Pages serves every file.

Vercel and Netlify can publish the same folder with no build. `vercel.json` and `netlify.toml` are already set for that. Add the Supabase URL and anon key to `data/config.json` before you deploy, or redeploy after you add them.

Vercel and Netlify can publish the same folder with no build. `vercel.json` and `netlify.toml` are already set for that. Add the Supabase URL and anon key to `data/config.json` before you deploy, or redeploy after you add them.
