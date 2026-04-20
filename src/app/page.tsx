"use client";

import type { Metadata } from "next";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Play, Trash2, Loader2, Bot, User, MessageSquare } from "lucide-react";

interface Message {
  id: string;
  role: "甲" | "乙";
  content: string;
  timestamp: Date;
}

interface Config {
  apiKey: string;
  modelA: {
    name: string;
    role: string;
    model: string;
  };
  modelB: {
    name: string;
    role: string;
    model: string;
  };
  plot: string;
  maxRounds: number;
}

export default function CrosstalkPage() {
  const [config, setConfig] = useState<Config>({
    apiKey: "",
    modelA: {
      name: "逗哏甲",
      role: "一位说话风趣、喜欢抖包袱的老相声演员",
      model: "Pro/deepseek-ai/DeepSeek-V3-0324",
    },
    modelB: {
      name: "捧哏乙",
      role: "一位稳重机智、擅长接话茬的捧哏演员",
      model: "Pro/zhipuai/GLM-4-0520",
    },
    plot: "两人讨论一个有趣的话题，比如现代科技给生活带来的变化",
    maxRounds: 6,
  });

  const [messages, setMessages] = useState<Message[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSpeaker, setCurrentSpeaker] = useState<"甲" | "乙" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, currentSpeaker]);

  // 清理函数
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const updateConfig = (path: string, value: string | number) => {
    setConfig((prev) => {
      const keys = path.split(".");
      const newConfig = { ...prev };
      let obj: Record<string, unknown> = newConfig;
      for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]] as Record<string, unknown>;
      }
      obj[keys[keys.length - 1]] = value;
      return newConfig;
    });
  };

  const startPerformance = async () => {
    if (!config.apiKey) {
      setError("请输入 API Key");
      return;
    }
    if (!config.modelA.model || !config.modelB.model) {
      setError("请设置两个模型的名称");
      return;
    }

    setError(null);
    setMessages([]);
    setIsPlaying(true);
    abortControllerRef.current = new AbortController();

    try {
      // 构建系统提示词
      const systemPromptA = `你是${config.modelA.name}，${config.modelA.role}。
你们正在进行一场相声表演。你的搭档是${config.modelB.name}。
请用幽默风趣的相声风格发言，每句话控制在50字以内。
剧情背景：${config.plot}
直接输出你的台词，不需要任何前缀标记。`;

      const systemPromptB = `你是${config.modelB.name}，${config.modelB.role}。
你们正在进行一场相声表演。你的搭档是${config.modelA.name}。
请用幽默风趣的相声风格发言，每句话控制在50字以内。
剧情背景：${config.plot}
直接输出你的台词，不需要任何前缀标记。`;

      // 构建对话历史
      const conversationHistory: Array<{ role: string; content: string }> = [];

      // 发送初始开场白请求给甲
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: config.apiKey,
          model: config.modelA.model,
          systemPrompt: systemPromptA,
          messages: conversationHistory,
          temperature: 0.8,
          maxTokens: 200,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "请求失败");
      }

      // 处理流式响应
      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      let currentMessage = "";
      let currentId = "";
      const decoder = new TextDecoder();

      // 第一轮：甲开场
      setCurrentSpeaker("甲");
      currentId = crypto.randomUUID();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                currentMessage += parsed.content;
                setMessages((prev) => {
                  const existing = prev.find((m) => m.id === currentId);
                  if (existing) {
                    return prev.map((m) =>
                      m.id === currentId ? { ...m, content: currentMessage } : m
                    );
                  } else {
                    return [
                      ...prev,
                      {
                        id: currentId,
                        role: "甲" as const,
                        content: currentMessage,
                        timestamp: new Date(),
                      },
                    ];
                  }
                });
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      // 更新对话历史
      conversationHistory.push({ role: "assistant", content: currentMessage });

      // 后续对话轮次
      for (let round = 1; round < config.maxRounds; round++) {
        // 乙回应
        setCurrentSpeaker("乙");
        const responseB = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: config.apiKey,
            model: config.modelB.model,
            systemPrompt: systemPromptB,
            messages: conversationHistory,
            temperature: 0.8,
            maxTokens: 200,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!responseB.ok) {
          const errorData = await responseB.json();
          throw new Error(errorData.error || "请求失败");
        }

        const readerB = responseB.body?.getReader();
        if (!readerB) throw new Error("无法读取响应流");

        let messageB = "";
        currentId = crypto.randomUUID();

        while (true) {
          const { done, value } = await readerB.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  messageB += parsed.content;
                  setMessages((prev) => {
                    const existing = prev.find((m) => m.id === currentId);
                    if (existing) {
                      return prev.map((m) =>
                        m.id === currentId ? { ...m, content: messageB } : m
                      );
                    } else {
                      return [
                        ...prev,
                        {
                          id: currentId,
                          role: "乙" as const,
                          content: messageB,
                          timestamp: new Date(),
                        },
                      ];
                    }
                  });
                }
              } catch {
                // 忽略解析错误
              }
            }
          }
        }

        conversationHistory.push({ role: "assistant", content: messageB });

        // 甲回应
        setCurrentSpeaker("甲");
        const responseA = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: config.apiKey,
            model: config.modelA.model,
            systemPrompt: systemPromptA,
            messages: conversationHistory,
            temperature: 0.8,
            maxTokens: 200,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!responseA.ok) {
          const errorData = await responseA.json();
          throw new Error(errorData.error || "请求失败");
        }

        const readerA = responseA.body?.getReader();
        if (!readerA) throw new Error("无法读取响应流");

        let messageA = "";
        currentId = crypto.randomUUID();

        while (true) {
          const { done, value } = await readerA.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  messageA += parsed.content;
                  setMessages((prev) => {
                    const existing = prev.find((m) => m.id === currentId);
                    if (existing) {
                      return prev.map((m) =>
                        m.id === currentId ? { ...m, content: messageA } : m
                      );
                    } else {
                      return [
                        ...prev,
                        {
                          id: currentId,
                          role: "甲" as const,
                          content: messageA,
                          timestamp: new Date(),
                        },
                      ];
                    }
                  });
                }
              } catch {
                // 忽略解析错误
              }
            }
          }
        }

        conversationHistory.push({ role: "assistant", content: messageA });
      }

      // 添加结束语
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "甲" as const,
          content: "得，感谢各位的捧场，咱们下次再见！",
          timestamp: new Date(),
        },
        {
          id: crypto.randomUUID(),
          role: "乙" as const,
          content: "哎，别走啊，还没说完呢！",
          timestamp: new Date(),
        },
      ]);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setError("表演已停止");
      } else {
        setError((err as Error).message || "发生未知错误");
      }
    } finally {
      setIsPlaying(false);
      setCurrentSpeaker(null);
    }
  };

  const stopPerformance = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsPlaying(false);
    setCurrentSpeaker(null);
  };

  const clearMessages = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/50 to-background p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* 标题 */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">AI 相声表演</h1>
          <p className="text-muted-foreground">
            两个大语言模型同台献艺，为你表演一段精彩相声
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* 左侧：配置面板 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                表演配置
              </CardTitle>
              <CardDescription>设置模型、角色和剧情</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* API Key */}
              <div className="space-y-2">
                <Label htmlFor="apiKey" className="text-destructive">
                  硅基流动 API Key
                </Label>
                <Input
                  id="apiKey"
                  type="password"
                  placeholder="sk-..."
                  value={config.apiKey}
                  onChange={(e) => updateConfig("apiKey", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  请从{" "}
                  <a
                    href="https://docs.siliconflow.cn/cn/userguide/introduction"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    硅基流动文档
                  </a>{" "}
                  获取 API Key
                </p>
              </div>

              <Separator />

              {/* 角色甲配置 */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-primary/10">
                    逗哏甲
                  </Badge>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="modelA">模型</Label>
                  <Input
                    id="modelA"
                    placeholder="如：Pro/deepseek-ai/DeepSeek-V3-0324"
                    value={config.modelA.model}
                    onChange={(e) => updateConfig("modelA.model", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nameA">角色名称</Label>
                  <Input
                    id="nameA"
                    placeholder="如：逗哏甲"
                    value={config.modelA.name}
                    onChange={(e) => updateConfig("modelA.name", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="roleA">角色设定</Label>
                  <Textarea
                    id="roleA"
                    placeholder="描述这个角色的性格特点..."
                    value={config.modelA.role}
                    onChange={(e) => updateConfig("modelA.role", e.target.value)}
                    rows={2}
                  />
                </div>
              </div>

              <Separator />

              {/* 角色乙配置 */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-secondary/10">
                    捧哏乙
                  </Badge>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="modelB">模型</Label>
                  <Input
                    id="modelB"
                    placeholder="如：Pro/zhipuai/GLM-4-0520"
                    value={config.modelB.model}
                    onChange={(e) => updateConfig("modelB.model", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nameB">角色名称</Label>
                  <Input
                    id="nameB"
                    placeholder="如：捧哏乙"
                    value={config.modelB.name}
                    onChange={(e) => updateConfig("modelB.name", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="roleB">角色设定</Label>
                  <Textarea
                    id="roleB"
                    placeholder="描述这个角色的性格特点..."
                    value={config.modelB.role}
                    onChange={(e) => updateConfig("modelB.role", e.target.value)}
                    rows={2}
                  />
                </div>
              </div>

              <Separator />

              {/* 剧情设置 */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="plot">剧情设定</Label>
                  <Textarea
                    id="plot"
                    placeholder="描述相声的主题和背景..."
                    value={config.plot}
                    onChange={(e) => updateConfig("plot", e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rounds">对话轮数</Label>
                  <Input
                    id="rounds"
                    type="number"
                    min={2}
                    max={10}
                    value={config.maxRounds}
                    onChange={(e) => updateConfig("maxRounds", parseInt(e.target.value) || 6)}
                  />
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-2">
                {!isPlaying ? (
                  <Button onClick={startPerformance} className="flex-1" size="lg">
                    <Play className="mr-2 h-4 w-4" />
                    开始表演
                  </Button>
                ) : (
                  <Button
                    onClick={stopPerformance}
                    variant="destructive"
                    className="flex-1"
                    size="lg"
                  >
                    停止表演
                  </Button>
                )}
                <Button
                  onClick={clearMessages}
                  variant="outline"
                  size="icon"
                  disabled={isPlaying || messages.length === 0}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {/* 错误提示 */}
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* 右侧：对话展示 */}
          <Card className="flex flex-col h-[calc(100vh-12rem)]">
            <CardHeader className="flex-shrink-0">
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                表演现场
              </CardTitle>
              <CardDescription>
                {isPlaying
                  ? `正在表演...${currentSpeaker === "甲" ? config.modelA.name : config.modelB.name}发言中`
                  : messages.length === 0
                  ? "点击开始表演"
                  : `已完成 ${Math.floor(messages.length / 2)} 轮对话`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full p-4" ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                    <MessageSquare className="mb-4 h-12 w-12 opacity-20" />
                    <p>等待表演开始...</p>
                    <p className="text-sm">配置好参数后点击「开始表演」</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((msg, index) => (
                      <div
                        key={msg.id}
                        className={`flex gap-3 ${
                          msg.role === "甲" ? "flex-row" : "flex-row-reverse"
                        }`}
                      >
                        <div
                          className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                            msg.role === "甲"
                              ? "bg-primary/10 text-primary"
                              : "bg-secondary/10 text-secondary-foreground"
                          }`}
                        >
                          {msg.role === "甲" ? (
                            <User className="h-5 w-5" />
                          ) : (
                            <Bot className="h-5 w-5" />
                          )}
                        </div>
                        <div
                          className={`flex-1 space-y-1 ${
                            msg.role === "甲" ? "text-left" : "text-right"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {msg.role === "甲" ? (
                              <span className="text-sm font-medium">
                                {config.modelA.name}
                              </span>
                            ) : (
                              <>
                                <span className="text-sm font-medium">
                                  {config.modelB.name}
                                </span>
                              </>
                            )}
                            {currentSpeaker === msg.role &&
                              isPlaying &&
                              index === messages.length - 1 && (
                                <Badge
                                  variant="secondary"
                                  className="animate-pulse text-xs"
                                >
                                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                  说话中
                                </Badge>
                              )}
                          </div>
                          <div
                            className={`inline-block rounded-lg px-4 py-2 ${
                              msg.role === "甲"
                                ? "bg-primary/5 text-foreground"
                                : "bg-secondary/5 text-foreground"
                            }`}
                          >
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
