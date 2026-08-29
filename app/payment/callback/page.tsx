"use client";

import {
  Suspense,
  useEffect,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";

function PaymentCallbackContent() {
  const searchParams = useSearchParams();

  const reference =
    searchParams.get("reference");

  const [status, setStatus] = useState(
    "Verifying your payment..."
  );

  const [error, setError] = useState("");

  useEffect(() => {
    if (!reference) {
      setStatus("");
      setError(
        "Payment reference was not found."
      );
      return;
    }

    async function verifyPayment() {
      try {
        const response = await fetch(
          "/api/payment/verify",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              reference,
            }),
          }
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "Payment verification failed."
          );
        }

        setStatus(
          data.message ||
            "Payment successful! Your votes have been recorded."
        );

        setTimeout(() => {
          window.location.href =
            "/#leaderboard";
        }, 3000);

      } catch (err: any) {
        console.error(
          "Payment verification error:",
          err
        );

        setStatus("");

        setError(
          err?.message ||
            "We could not verify your payment."
        );
      }
    }

    verifyPayment();
  }, [reference]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "30px",
        background: "#f7f5ef",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "500px",
          background: "white",
          padding: "40px",
          textAlign: "center",
          border: "1px solid #dedbd2",
        }}
      >
        <div
          style={{
            fontSize: "18px",
            fontWeight: 700,
            letterSpacing: "2px",
            color: "#063c2c",
            marginBottom: "20px",
          }}
        >
          ASCLEPIUS AWARDS 2026
        </div>

        {!error ? (
          <>
            <h1>
              Payment Successful
            </h1>

            <p
              style={{
                marginTop: "15px",
                lineHeight: 1.6,
              }}
            >
              {status}
            </p>

            {reference && (
              <p
                style={{
                  marginTop: "20px",
                  fontSize: "13px",
                  color: "#777",
                  wordBreak: "break-all",
                }}
              >
                Reference: {reference}
              </p>
            )}
          </>
        ) : (
          <>
            <h1>
              Payment Verification
            </h1>

            <p
              style={{
                color: "#b42318",
                marginTop: "15px",
                lineHeight: 1.6,
              }}
            >
              {error}
            </p>

            {reference && (
              <p
                style={{
                  marginTop: "20px",
                  fontSize: "13px",
                  color: "#777",
                  wordBreak: "break-all",
                }}
              >
                Reference: {reference}
              </p>
            )}
          </>
        )}

        <a
          href="/"
          style={{
            display: "inline-block",
            marginTop: "25px",
            padding: "12px 22px",
            background: "#063c2c",
            color: "white",
            textDecoration: "none",
          }}
        >
          Return to Awards
        </a>
      </div>
    </main>
  );
}

export default function PaymentCallbackPage() {
  return (
    <Suspense
      fallback={
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f7f5ef",
          }}
        >
          <div
            style={{
              textAlign: "center",
            }}
          >
            <h2>
              ASCLEPIUS AWARDS 2026
            </h2>

            <p>
              Loading payment verification...
            </p>
          </div>
        </main>
      }
    >
      <PaymentCallbackContent />
    </Suspense>
  );
}
