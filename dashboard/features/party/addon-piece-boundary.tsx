"use client";
import { Component, type ReactNode } from "react";

// One add-on piece's error boundary: a piece that throws blanks itself and leaves its place and
// the other pieces drawn. React offers a boundary only as a class component.
export class AddonPieceBoundary extends Component<{ addon: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error(`The add-on ${this.props.addon}'s dashboard piece failed`, error); }
  render() { return this.state.failed ? null : this.props.children; }
}
