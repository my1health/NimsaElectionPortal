"use client";

import { useEffect, useState } from "react";

type Category = {
  id: string;
  name: string;
  description: string | null;
};

type Nominee = {
  id: string;
  name: string;
  bio: string | null;
  category_id: string;
  photo_url: string | null;
};

type Result = Nominee & {
  votes: number;
};

const VOTE_PRICE = 100;

export default function Home() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [nominees, setNominees] = useState<Nominee[]>([]);
  const [results, setResults] = useState<Result[]>([]);

  const [selected, setSelected] = useState<Nominee | null>(null);
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");

  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/categories", {
        cache: "no-store",
      });

      const data = await r.json();

      if (!r.ok) {
        throw new Error(data.error || "Unable to load awards.");
      }

      setCategories(data.categories || []);
      setNominees(data.nominees || []);
      setResults(data.results || []);
    } catch (error: any) {
      setMessage(error.message || "Unable to load awards.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openVote(nominee: Nominee) {
    setSelected(nominee);
    setEmail("");
    setAmount("");
    setMessage("");
  }

  function closeVote() {
    if (busy) return;

    setSelected(null);
    setEmail("");
    setAmount("");
    setMessage("");
  }

  const amountNumber = Number(amount);

  const voteCount =
    Number.isFinite(amountNumber) &&
    amountNumber >= VOTE_PRICE &&
    amountNumber % VOTE_PRICE === 0
      ? amountNumber / VOTE_PRICE
      : 0;

  async function payForVotes() {
    if (!selected) return;

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setMessage("Please enter your email.");
      return;
    }

    if (!cleanEmail.includes("@")) {
      setMessage("Please enter a valid email.");
      return;
    }

    if (!Number.isFinite(amountNumber)) {
      setMessage("Please enter a valid amount.");
      return;
    }

    if (amountNumber < VOTE_PRICE) {
      setMessage("Minimum payment is ₦100.");
      return;
    }

    if (amountNumber % VOTE_PRICE !== 0) {
      setMessage("Amount must be a multiple of ₦100.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/payment/initialize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: cleanEmail,
          nomineeId: selected.id,
          amount: amountNumber,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Unable to start payment."
        );
      }

      window.location.href = data.authorization_url;
    } catch (error: any) {
      setMessage(
        error.message || "Payment could not be started."
      );
      setBusy(false);
    }
  }

  return (
    <>
      {/* NAVBAR */}

      <nav className="navbar">
        <div className="nav-inner">

          <div className="brand">

            <div className="brand-mark">
              N
            </div>

            <div>
              <div className="brand-title">
                NiMSA
              </div>

              <div className="brand-subtitle">
                ASCLEPIUS AWARDS 2026
              </div>
            </div>

          </div>

          <div className="nav-links">
            <a href="#awards">
              Awards
            </a>

            <a href="#leaderboard">
              Leaderboard
            </a>

            <a href="/admin/login">
              Admin
            </a>
          </div>

        </div>
      </nav>


      {/* HERO */}

      <header className="hero-awards">

        <div className="hero-overlay" />

        <div className="hero-decoration">
          <div />
          <div />
          <div />
        </div>

        <div className="hero-content">

          <span className="hero-badge">
            NiMSA PRESENTS
          </span>

          <p className="hero-small">
            ASCLEPIUS AWARDS
          </p>

          <h1>
            2026
          </h1>

          <p className="hero-description">
            Celebrating exceptional personalities,
            leaders and changemakers making an
            outstanding impact within NiMSA and
            beyond.
          </p>

          <a
            href="#awards"
            className="hero-button"
          >
            VOTE NOW
            <span>→</span>
          </a>

        </div>

      </header>


      {/* INTRO */}

      <section className="intro-section">

        <div className="section-container">

          <div className="gold-line" />

          <p className="eyebrow">
            NIМSA • ASCLEPIUS AWARDS 2026
          </p>

          <h2>
            Recognising Excellence
          </h2>

          <p className="intro-text">
            The Asclepius Awards 2026 celebrates
            outstanding individuals whose leadership,
            creativity, service and achievements have
            made a meaningful difference.
          </p>

        </div>

      </section>


      {/* CATEGORIES */}

      <section
        className="categories-section"
        id="awards"
      >

        <div className="section-container">

          <div className="section-heading">

            <div>

              <p className="eyebrow">
                THE NOMINEES
              </p>

              <h2>
                Awards Categories
              </h2>

            </div>

            <p>
              Choose a category, select your
              preferred nominee and cast your
              votes.
            </p>

          </div>


          <div className="category-list">

            {categories.map((category, categoryIndex) => {

              const categoryNominees =
                nominees.filter(
                  nominee =>
                    nominee.category_id ===
                    category.id
                );

              return (

                <div
                  className="category-block"
                  key={category.id}
                >

                  <div className="category-header">

                    <div className="category-number">
                      {String(
                        categoryIndex + 1
                      ).padStart(2, "0")}
                    </div>

                    <div>

                      <p className="category-label">
                        AWARD CATEGORY
                      </p>

                      <h3>
                        {category.name}
                      </h3>

                      <p>
                        {category.description ||
                          "Choose your preferred nominee."}
                      </p>

                    </div>

                  </div>


                  {categoryNominees.length === 0 ? (

                    <div className="empty-nominees">
                      No nominees yet.
                    </div>

                  ) : (

                    <div className="nominee-grid">

                      {categoryNominees.map(
                        (nominee, index) => (

                          <article
                            className="nominee-card"
                            key={nominee.id}
                          >

                            <div className="nominee-image">

                              {nominee.photo_url ? (

                                <img
                                  src={
                                    nominee.photo_url
                                  }
                                  alt={
                                    nominee.name
                                  }
                                />

                              ) : (

                                <div className="no-photo">
                                  {nominee.name
                                    .charAt(0)
                                    .toUpperCase()}
                                </div>

                              )}

                              <span className="nominee-number">
                                NOMINEE{" "}
                                {String(
                                  index + 1
                                ).padStart(2, "0")}
                              </span>

                            </div>


                            <div className="nominee-content">

                              <h4>
                                {nominee.name}
                              </h4>

                              <p>
                                {nominee.bio ||
                                  "Outstanding nominee in this award category."}
                              </p>

                              <button
                                className="nominee-vote"
                                onClick={() =>
                                  openVote(
                                    nominee
                                  )
                                }
                              >

                                <span>
                                  VOTE FOR NOMINEE
                                </span>

                                <strong>
                                  →
                                </strong>

                              </button>

                            </div>

                          </article>

                        )
                      )}

                    </div>

                  )}

                </div>

              );
            })}

          </div>

        </div>

      </section>


      {/* LEADERBOARD */}

      <section
        className="leaderboard-section"
        id="leaderboard"
      >

        <div className="section-container">

          <div className="leaderboard-heading">

            <p className="eyebrow">
              LIVE RESULTS
            </p>

            <h2>
              Current Leaderboard
            </h2>

            <p>
              Results update as verified votes
              are recorded.
            </p>

          </div>


          <div className="leaderboard">

            {categories.map(category => {

              const list = results
                .filter(
                  result =>
                    result.category_id ===
                    category.id
                )
                .sort(
                  (a, b) =>
                    b.votes - a.votes
                );

              return (

                <div
                  className="leader-category"
                  key={category.id}
                >

                  <h3>
                    {category.name}
                  </h3>


                  {list.length === 0 ? (

                    <p className="leader-empty">
                      No votes yet.
                    </p>

                  ) : (

                    list.map(
                      (result, index) => (

                        <div
                          className="leader-row"
                          key={result.id}
                        >

                          <div className="rank">
                            #{index + 1}
                          </div>


                          {result.photo_url ? (

                            <img
                              src={
                                result.photo_url
                              }
                              alt={
                                result.name
                              }
                            />

                          ) : (

                            <div className="leader-avatar">
                              {result.name
                                .charAt(0)
                                .toUpperCase()}
                            </div>

                          )}


                          <div className="leader-name">

                            <strong>
                              {result.name}
                            </strong>

                            <span>
                              NOMINEE
                            </span>

                          </div>


                          <div className="vote-count">

                            <strong>
                              {result.votes}
                            </strong>

                            <span>
                              {result.votes === 1
                                ? "VOTE"
                                : "VOTES"}
                            </span>

                          </div>

                        </div>

                      )
                    )

                  )}

                </div>

              );

            })}

          </div>

        </div>

      </section>


      {/* FOOTER */}

      <footer className="footer">

        <div className="section-container">

          <div className="footer-brand">

            <div className="brand-mark">
              N
            </div>

            <div>

              <strong>
                NiMSA
              </strong>

              <span>
                Asclepius Awards 2026
              </span>

            </div>

          </div>


          <p>
            Celebrating excellence,
            leadership and impact.
          </p>


          <div className="footer-bottom">
            © 2026 NiMSA • Asclepius Awards
            2026 • Official Voting Portal
          </div>

        </div>

      </footer>


      {/* VOTING MODAL */}

      {selected && (

        <div className="modal-backdrop">

          <div className="vote-modal">

            <button
              className="modal-close"
              onClick={closeVote}
              disabled={busy}
            >
              ×
            </button>


            <p className="modal-label">
              CAST YOUR VOTE
            </p>


            <h2>
              Vote for{" "}
              <span>
                {selected.name}
              </span>
            </h2>


            <p className="modal-category">
              {categories.find(
                category =>
                  category.id ===
                  selected.category_id
              )?.name}
            </p>


            {selected.photo_url && (

              <img
                className="modal-photo"
                src={selected.photo_url}
                alt={selected.name}
              />

            )}


            <p className="modal-instruction">
              Each vote costs{" "}
              <strong>₦100</strong>.
              Enter the amount you wish
              to spend.
            </p>


            <label>
              Email Address
            </label>

            <input
              className="email-input"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e =>
                setEmail(e.target.value)
              }
              disabled={busy}
            />


            <label
              style={{
                display: "block",
                marginTop: 15,
                marginBottom: 7,
              }}
            >
              Amount (₦)
            </label>

            <input
              className="email-input"
              type="number"
              min="100"
              step="100"
              placeholder="100"
              value={amount}
              onChange={e =>
                setAmount(e.target.value)
              }
              disabled={busy}
            />


            {amount && (

              <div
                className="modal-message"
                style={{
                  background:
                    voteCount > 0
                      ? "#e6f4ec"
                      : "#fbeaea",
                  color:
                    voteCount > 0
                      ? "#17633d"
                      : "#9c3030",
                }}
              >

                {voteCount > 0 ? (

                  <>
                    <strong>
                      {voteCount}{" "}
                      {voteCount === 1
                        ? "vote"
                        : "votes"}
                    </strong>{" "}
                    for{" "}
                    <strong>
                      {selected.name}
                    </strong>
                  </>

                ) : (

                  "Amount must be a multiple of ₦100."

                )}

              </div>

            )}


            {message && (

              <div className="modal-message error">
                {message}
              </div>

            )}


            <button
              className="submit-vote"
              disabled={
                busy ||
                voteCount < 1
              }
              onClick={
                payForVotes
              }
            >

              {busy
                ? "OPENING PAYSTACK..."
                : `PAY ₦${
                    amountNumber > 0
                      ? amountNumber.toLocaleString()
                      : "0"
                  }`}

            </button>


            <button
              className="submit-vote"
              style={{
                background:
                  "transparent",
                color:
                  "var(--green)",
                border:
                  "1px solid var(--border)",
              }}
              disabled={busy}
              onClick={closeVote}
            >
              CANCEL
            </button>


            <p className="modal-note">
              You will be redirected to
              Paystack to complete your
              payment securely.
            </p>

          </div>

        </div>

      )}

    </>
  );
}
