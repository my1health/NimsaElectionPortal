"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AdminLogin() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase()
      .auth
      .getUser()
      .then(({ data }) => {
        if (data.user) {
          router.replace("/admin");
        }
      });
  }, [router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    setLoading(true);
    setError("");

    const db = supabase();

    const { data, error } =
      await db.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

    if (error || !data.user) {
      setError(
        error?.message || "Login failed."
      );

      setLoading(false);
      return;
    }

    // Check if this user is actually an admin
    const { data: admin } = await db
      .from("admins")
      .select("id")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!admin) {
      await db.auth.signOut();

      setError(
        "This account is not authorized as an administrator."
      );

      setLoading(false);
      return;
    }

    router.replace("/admin");
  }

  return (
    <main
      className="container section"
      style={{ maxWidth: 520 }}
    >
      <div className="card">

        <span className="badge">
          NiMSA ADMIN
        </span>

        <h1>Admin Login</h1>

        <p className="muted">
          Authorized organizers only.
        </p>

        <form
          className="form"
          onSubmit={handleLogin}
        >

          <label>Email</label>

          <input
            type="email"
            required
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            placeholder="Admin email"
          />

          <label>Password</label>

          <input
            type="password"
            required
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
            placeholder="Password"
          />

          {error && (
            <div className="notice error">
              {error}
            </div>
          )}

          <button
            className="primary"
            disabled={loading}
          >
            {loading
              ? "Signing in..."
              : "LOGIN"}
          </button>

        </form>
      </div>
    </main>
  );
}
