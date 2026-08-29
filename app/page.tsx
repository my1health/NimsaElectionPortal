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
  const [categories, setCategories] =
    useState<Category[]>([]);

  const [nominees, setNominees] =
    useState<Nominee[]>([]);

  const [results, setResults] =
    useState<Result[]>([]);

  const [selected, setSelected] =
    useState<Nominee | null>(null);

  const [email, setEmail] =
    useState("");

  const [amount, setAmount] =
    useState("");

  const [message, setMessage] =
    useState("");

  const [busy, setBusy] =
    useState(false);

  async function load() {
    try {
      const r = await fetch(
        "/api/categories",
        {
          cache: "no-store"
        }
      );

      const data = await r.json();

      if (!r.ok) {
        throw new Error(
          data.error ||
            "Unable to load awards."
        );
      }

      setCategories(
        data.categories || []
      );

      setNominees(
        data.nominees || []
      );

      setResults(
        data.results || []
      );

    } catch (error: any) {
      setMessage(
        error.message ||
          "Unable to load awards."
      );
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openVote(
    nominee: Nominee
  ) {
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

  const amountNumber =
    Number(amount);

  const voteCount =
    Number.isFinite(amountNumber) &&
    amountNumber >= VOTE_PRICE &&
    amountNumber % VOTE_PRICE === 0
      ? amountNumber / VOTE_PRICE
      : 0;

  async function payForVotes() {
    if (!selected) {
      return;
    }

    const cleanEmail =
      email.trim().toLowerCase();

    if (!cleanEmail) {
      setMessage(
        "Please enter your email."
      );
      return;
    }

    if (
      !cleanEmail.includes("@")
    ) {
      setMessage(
        "Please enter a valid email."
      );
      return;
    }

    if (
      !Number.isFinite(amountNumber)
    ) {
      setMessage(
        "Please enter a valid amount."
      );
      return;
    }

    if (
      amountNumber < VOTE_PRICE
    ) {
      setMessage(
        "Minimum payment is ₦100."
      );
      return;
    }

    if (
      amountNumber % VOTE_PRICE !== 0
    ) {
      setMessage(
        "Amount must be a multiple of ₦100."
      );
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const response =
        await fetch(
          "/api/payment/initialize",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({
              email: cleanEmail,
              nomineeId:
                selected.id,
              amount:
                amountNumber
            })
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Unable to start payment."
        );
      }

      /*
       * Redirect voter to Paystack checkout.
       */
      window.location.href =
        data.authorization_url;

    } catch (error: any) {

      setMessage(
        error.message ||
          "Payment could not be started."
      );

      setBusy(false);
    }
  }

  return (
    <>
      {/* HERO */}

      <header className="hero">
        <div className="container">

          <span className="badge">
            NiMSA PRESENTS
          </span>

          <h1>
            Asclepius Awards 2026
          </h1>

          <p>
            Vote for the personalities
            who have made an outstanding
            impact.
          </p>

        </div>
      </header>


      {/* CATEGORIES */}

      <main className="container section">

        <h2>
          Awards Categories
        </h2>

        <p>
          Select a category and vote
          for your preferred nominee.
        </p>


        <div className="grid">

          {categories.map(
            category => (

              <section
                className="card"
                key={category.id}
              >

                <h3>
                  {category.name}
                </h3>

                <p>
                  {
                    category.description ||
                    "Choose your preferred nominee."
                  }
                </p>


                <div>

                  {nominees
                    .filter(
                      nominee =>
                        nominee.category_id ===
                        category.id
                    )
                    .map(
                      nominee => (

                        <div
                          key={nominee.id}
                          style={{
                            marginBottom: 20
                          }}
                        >

                          {/* PHOTO */}

                          {nominee.photo_url && (
                            <img
                              src={
                                nominee.photo_url
                              }
                              alt={
                                nominee.name
                              }
                              style={{
                                width: "100%",
                                maxWidth: 180,
                                height: 180,
                                objectFit:
                                  "cover",
                                borderRadius: 14,
                                display:
                                  "block",
                                marginBottom:
                                  10
                              }}
                            />
                          )}


                          <strong>
                            {nominee.name}
                          </strong>


                          {nominee.bio && (
                            <p
                              style={{
                                margin:
                                  "4px 0 10px"
                              }}
                            >
                              {nominee.bio}
                            </p>
                          )}


                          <button
                            className="voteBtn"
                            onClick={() =>
                              openVote(
                                nominee
                              )
                            }
                          >
                            VOTE
                          </button>

                        </div>

                      )
                    )}


                  {!nominees.some(
                    nominee =>
                      nominee.category_id ===
                      category.id
                  ) && (

                    <p className="muted">
                      No nominees yet.
                    </p>

                  )}

                </div>

              </section>

            )
          )}

        </div>


        {/* LEADERBOARD */}

        <section className="section">

          <h2>
            Current Leaderboard
          </h2>

          <div className="card">

            {categories.map(
              category => {

                const list =
                  results
                    .filter(
                      x =>
                        x.category_id ===
                        category.id
                    )
                    .sort(
                      (a, b) =>
                        b.votes -
                        a.votes
                    );

                return (

                  <div
                    key={category.id}
                    style={{
                      marginBottom: 25
                    }}
                  >

                    <h3>
                      {category.name}
                    </h3>


                    {list.length === 0 && (
                      <p className="muted">
                        No votes yet.
                      </p>
                    )}


                    {list.map(
                      (x, i) => (

                        <div
                          className="rank"
                          key={x.id}
                        >

                          <span>
                            #{i + 1}{" "}
                            {x.name}
                          </span>

                          <strong>
                            {x.votes}{" "}
                            {x.votes === 1
                              ? "vote"
                              : "votes"}
                          </strong>

                        </div>

                      )
                    )}

                  </div>

                );
              }
            )}

          </div>

        </section>

      </main>


      {/* PAYMENT MODAL */}

      {selected && (

        <div className="modalWrap">

          <div className="modal">

            <h2>
              Vote for{" "}
              {selected.name}
            </h2>


            <p>
              Each vote costs{" "}
              <strong>₦100</strong>.
            </p>


            <p>
              Enter the amount you want
              to pay. Your votes will be
              calculated automatically.
            </p>


            <label>
              Email Address
            </label>

            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e =>
                setEmail(
                  e.target.value
                )
              }
              disabled={busy}
            />


            <label>
              Amount (₦)
            </label>

            <input
              type="number"
              min="100"
              step="100"
              placeholder="100"
              value={amount}
              onChange={e =>
                setAmount(
                  e.target.value
                )
              }
              disabled={busy}
            />


            {/* VOTE CALCULATOR */}

            {amount && (

              <div
                className="notice"
                style={{
                  marginTop: 12
                }}
              >

                {voteCount > 0 ? (

                  <>
                    <strong>
                      {voteCount}{" "}
                      {voteCount === 1
                        ? "vote"
                        : "votes"}
                    </strong>

                    {" "}for{" "}

                    <strong>
                      {selected.name}
                    </strong>

                  </>

                ) : (

                  "Enter an amount in multiples of ₦100."

                )}

              </div>

            )}


            {message && (

              <div
                className="notice error"
                style={{
                  marginTop: 12
                }}
              >
                {message}
              </div>

            )}


            <button
              className="voteBtn"
              disabled={
                busy ||
                voteCount < 1
              }
              onClick={
                payForVotes
              }
            >

              {busy
                ? "Opening Paystack..."
                : `PAY ₦${
                    amountNumber > 0
                      ? amountNumber.toLocaleString()
                      : "0"
                  }`}

            </button>


            <button
              className="voteBtn close"
              disabled={busy}
              onClick={
                closeVote
              }
            >
              CANCEL
            </button>


            <p
              className="muted"
              style={{
                fontSize: 12,
                marginTop: 15
              }}
            >
              You will be redirected
              to Paystack to complete
              your payment securely.
            </p>

          </div>

        </div>

      )}


      <footer className="footer">
        NiMSA • Asclepius Awards 2026
        • Official Voting Portal
      </footer>

    </>
  );
}
