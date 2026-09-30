'use client';

import { useState } from 'react';
import type { AcademyQuizQuestion } from '@/data/academyLessons';

export default function LessonQuiz({ questions }: { questions: AcademyQuizQuestion[] }) {
    const [answers, setAnswers] = useState<Record<number, number>>({});
    const [submitted, setSubmitted] = useState(false);
    if (!questions.length) return null;
    const score = questions.reduce((total, question, index) => total + (answers[index] === question.answer ? 1 : 0), 0);
    return <section className="lesson-quiz">
        <span className="article-kicker">KENDİNİ DENE</span>
        <h2>Kısa bilgi kontrolü</h2>
        <div className="quiz-questions">
            {questions.map((question, questionIndex) => <fieldset key={`${questionIndex}-${question.question}`} className="quiz-question">
                <legend>{questionIndex + 1}. {question.question}</legend>
                <div className="quiz-options">{question.options.map((option, optionIndex) => {
                    const selected = answers[questionIndex] === optionIndex;
                    const correct = submitted && question.answer === optionIndex;
                    const incorrect = submitted && selected && !correct;
                    return <label key={optionIndex} className={correct ? 'quiz-option quiz-option-correct' : incorrect ? 'quiz-option quiz-option-incorrect' : 'quiz-option'}>
                        <input type="radio" name={`quiz-${questionIndex}`} value={optionIndex} checked={selected ?? false} disabled={submitted} onChange={() => setAnswers((current) => ({ ...current, [questionIndex]: optionIndex }))} />
                        <span>{option}</span>
                    </label>;
                })}</div>
                {submitted && question.explanation && <p className="quiz-explanation">{question.explanation}</p>}
            </fieldset>)}
        </div>
        <div className="quiz-footer">
            {submitted && <strong role="status">{score}/{questions.length} doğru yanıt</strong>}
            <button type="button" disabled={Object.keys(answers).length !== questions.length} onClick={() => { if (submitted) { setSubmitted(false); setAnswers({}); } else setSubmitted(true); }}>
                {submitted ? 'Yeniden dene' : 'Yanıtları kontrol et'}
            </button>
        </div>
    </section>;
}
