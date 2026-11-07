# Prompts: submission-prep session: README, video, rules check (Harman's laptop, 7 Nov)

Every prompt the team typed into this Claude Code session, verbatim and in order (times in IST). Removed: tool output, background-task notifications, and automatic context summaries (AI-written). Screenshots appear as `[Image #n]`; the images are not included.

**Sat 07 Nov 05:11 IST**

> Now you know the entire project. I want to see the README, and I want us to make the README better. Do not implement anything for now, but I want to think about how we position this in a better way. This is, right now, the straight technical terms that we're using, but maybe we can use better terms that make our project sound better and more likely to win. I don't want to use those impressive things without obviously lying. Tell me.

**Sat 07 Nov 05:15 IST**

> also we should remove the limitations that we are typing at the end right.

**Sat 07 Nov 05:17 IST**

> what should be the flow of the 2-4 minute video. actually cool, actually good copywriting and natural speaking, which also impresses them and we'll have only 2 people speaking but we'll tell probably that we're a team of 5. and then how should we make it. gather evidence from winners too

**Sat 07 Nov 05:24 IST**

> Can you take a look at all of the rules and guidelines about anything that is published on the website, which we are not following right now? I want us to follow them. Anything that can disqualify us, anything that might be better, partner tracks, main track, anything. Also, probably they shared a lot of things on Discord. I'll just check them once, but give me that. just the list - no implementation yet.

**Sat 07 Nov 05:24 IST**

> Can you take a look at all of the rules and guidelines about anything that is published on the website, which we are not following right now? I want us to follow them. Anything that can disqualify us, anything that might be better, partner tracks, main track, anything. Also, probably they shared a lot of things on Discord. I'll just check them once, but give me that. just the list - no implementation yet. only point them out which we dont follow or something

**Sat 07 Nov 05:45 IST**

> i want us to do the following fixes - you can ask me qeustions. 
>
> <pasted_content id="3b13">
> The AI-use rules are a real risk. The rules say AI should "assist your development process, not create the entire project." Projects relying "entirely on AI without meaningful contributions from team members" may lose partner and finalist eligibility.
>    - 201 of 228 commits carry Co-Authored-By: Claude.
>    - docs/ai-use.md has 9 lines. It says the project was "built with an AI coding assistant working from the team's PRD," and the human work it lists is only key custody, deployment, wallet testing and the video.
>    - As written, that reads as "AI built it." It needs a truthful, specific account of what each team member decided, designed, reviewed, debugged and tested, and where AI was used in each area.
>    - The rules also say "spec files, prompts and planning artifacts must be included." The PRD and plans are in the repo; the prompts are not.
> 3. Possible pre-existing work. The PRD (docs/spec/BLACKOUT-technical-PRD.txt) was committed 15 seconds after "first commit" (6 Nov, 03:28 IST).
>    - If the PRD was written before kickoff, it is a pre-existing project-specific design. On the Classic track that makes you ineligible for partner prizes and the finalist round unless it is disclosed.
>    - Undisclosed pre-existing work, or anything that "materially misrepresents what was built," can mean disqualification and a ban.
>    - Confirm when it was written. If it predates kickoff, disclose it in writing to ETHGlobal and in the submission.
> </pasted_content id="3b13">
>
>  For the AI use thing, we have done a lot of work ourselves, including testing, making wallets, making accounts, and a lot of the code too. Just co-authored by Claude does not mean that we did not make it. It is co-authored. I want to be sure that this rule does not eliminate us.
>
> I've already fixed the GitHub repo to be public now, but I want to add that a lot of members decided, designed, reviewed, debugged, and tested on all of the surfaces, sometimes with AI use and sometimes even completely without it. I want you to attach spec files, prompts, and planning artifacts, whatever you have in the history. If not, then tell me what you don't have, and I will be attaching them.
>
> The coding has been done majorly from two laptops, one of them being you. Attach everything that you have, but make sure that I am clear of this rule.
>
> Also, for possible pre-existing work, the PRD was committed 15 seconds after, but it was way after the kickoff. I don't think that should count, but if it does, I want you to fix that as well because it's an honest, obvious thing. After the commit itself, we committed the PRD. It wasn't that after the first commit the work was started, but we started the work after 9 pm, way after 9 pm, and then committed. it is a team of 5 for sure. that we are already seelecting and their names in the submission place. 
>
> <pasted_content id="3b13">
> 🟠 Track requirements you don't fully meet yet
>
> Uniswap ("Build with Uniswap")
>
> 6. The Uniswap Developer Feedback Form must be submitted with a link to your FEEDBACK.md. I can't check whether you've done this, and the link only works once the repo is public.
> 7. Some README line links have drifted. Uniswap says the README must "clearly point to the relevant contracts and lines of code."
>    - decodeV4 is cited at decode.ts#L76-L113 but now starts at line 156.
>    - The Guard rules are cited at guard.ts#L45, but guard() is now at line 55.
>    - Some Uniswap v3 links are off by a few lines, and the rest need checking.
>
> ENS ("Best Use of ENSv2")
>
> 8. The showcase must link to a live demo. Put the Vercel URL and the kit URL in the submission.
> 9. The ENS rules say "not just hard-coded values." The newest commit added a simulated hero on the site. Label it clearly as a simulation, and make sure the demo link sends judges to the real, working kit and Attack Theater.
> 10. ENS offers "bonus points if you bring AI agents into the mix." You have this: the watcher has its own ENS identity, and Claude writes its warning note. The README barely sells it, and nothing says "for ENS judges."
>
> EF ("Best CROPS App")
>
> 11. The CROPS section is too long. The rule is "one or two lines per letter." The C and P entries are multi-bullet paragraphs. Shorten them and leave the detail in docs/crops.md.
> 12. The video must be 3 minutes or less (the main track allows up to 4).
> 13. Choose CROPS as your EF prize, not Anon-RPC: docs/crops.md says Anon-RPC was "evaluated, not shipped," and that track requires it by default. You can be placed in only one EF prize.
> 14. "No third-party trackers or analytics in the client": I found none in the site, kit or extension source. Also confirm that Vercel Web Analytics and Speed Insights are off in the Vercel dashboard, because they can be turned on without any code change.
> </pasted_content id="3b13">
>
>  I want you to make us meet all the track requirements for all three partners that we've selected. For Uniswap developer feedback, you can think about the feedback for exactly what we need in our platform and add that README exactly the way they want. The same thing for ENS and the same thing for EF. We already have a live demo, and we'll be putting that in the video. Make sure that the guidelines that these people are saying are covered and we qualify for all of their criteria - this is very inmportant that you dont miss any. 
>
> <pasted_content id="3b13">
> 15. The README doesn't separate new work from reused work. The rules ask you to "clearly distinguish between what's new and what's reused." Add a short "Built at ETHGlobal Mumbai" note covering:
>     - the libraries: viem, Preact, Vite, Foundry, the Safe and ENSv2 contracts
>     - reused data: PTXPhish, ScamSniffer, the Ledger and Balancer payloads, Curve fixtures
>     - ported code: the Uniswap math
> </pasted_content id="3b13">
>
>  do this with whats true and right. after all of this still run a check and tell me if there is anything which we still do not do right and might get disqualified. we are making the video and the submission will be done before 8 am

