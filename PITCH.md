# SUBXVoice — keep working, say the rest

**A voice helper for Windows, powered by Gnani AI's Prisma, that understands Hindi, English, or both in one sentence and acts on what it hears.**
Built by Bhavesh Parmar and Aarnav Mathakiya. **Try it:** [subxvoice.vercel.app](https://subxvoice.vercel.app) · **Code:** [GitHub](https://github.com/voldemort9999/subxvoice-app)

## The problem

A working day keeps breaking into small jobs: a task to note down, a file to find, earbuds to connect, a reply to send. Each one pulls you out of what you were doing. We speak far faster than we type, yet PC voice tools mostly type rather than act. They also expect one language at a time, while much of India speaks in a mix, like *"kal meeting hai, slides ready rakhna"*. And for many people, typing is a barrier in itself.

## The solution

SUBXVoice sits in the tray, and two keys work from inside any app:

- **Follow My Words** (Ctrl + Alt): say a task, and it's done in front of you.
- **Dictation** (Ctrl + Win): your words are typed at the cursor. Ask for an email or a message and you get the finished one.

## Gnani Prisma is the heart of it

Every word SUBXVoice acts on is heard by **Prisma**, Gnani AI's speech model trained in India for Indian speech. It sits in front of everything else.

- **It hears India as it speaks.** Hindi and English come back together as one sentence, so *"WhatsApp pe Aryan ko likho aaj main nahi aa paunga"* reaches the app as a single request it can act on, not as broken fragments.
- **It is fast enough to feel instant.** Audio streams to Prisma while you are still talking, so once you let go, the app waits only for your last words.
- **It holds up in real rooms.** We tested it with background noise, and a personal dictionary teaches it the names it keeps mishearing.
- **It gives Prisma a second job.** A speech-to-text model normally writes things down. Here, the same hearing also runs the computer: it opens apps, finds files, connects devices and types into chats.
- **It opens the way to regional India.** Prisma accepts ten languages: Bengali, Gujarati, Hindi, Kannada, Malayalam, Marathi, Punjabi, Tamil, Telugu and Indian English, and our integration already supports all ten. The app ships with Hindi-English, because in our test auto-detection heard a Hinglish clip as Telugu. A language picker is next, so every speaker can choose their own language, with each one tested before release.

## A day with it

| You say | What happens |
|---|---|
| "Notepad kholo aur aaj ke tasks likho: client ko call karna, report bhejna" | Notepad opens and the list is typed (one sentence, two steps) |
| "Pictures wale folder mein mera resume dhoondo" | Pictures opens with `My Resume.pdf` selected |
| "OnePlus Buds connect karo" · "YouTube pe Kesariya chalao" | The earbuds connect and the song plays |
| "WhatsApp pe Aryan ko likho aaj main nahi aa paunga" | The message is typed in his chat. **It is never sent for you** |
| "boss ko email likho ki kal chhutti chahiye, tabiyat theek nahi hai" | A full leave email, signed with your name |

## How it works

Prisma turns your speech into text. A planner breaks the text into steps, and Windows carries them out. Inside apps, the planner reads on-screen names as text and takes no screenshots. Dictation pastes the text, in Roman letters or Devanagari, where your cursor is, and it never translates.
The planning and writing run on general LLMs: Gemini 2.5 Flash, Jev and gpt-oss-120b.

## Safe and shipped

- **Safe:**
  - It never sends a message on its own.
  - The mic is on only while a key is held.
  - Transcripts stay on your PC.
  - It needs no admin rights.
- **Live:** version 0.4.2 has a public installer and auto-updates. The free beta includes 2 hours a day.
- **Next:** regional languages through Prisma.
