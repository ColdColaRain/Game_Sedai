import { useMemo, useRef, useEffect } from "react"
import gameData, { getGameTitle } from "../game-data"
import { posterByTitle } from "../poster-map"
import { domToBlob } from "modern-screenshot"
import { toast } from "sonner"
import { usePersistState } from "./hooks"
import { useI18n } from "./i18n-context"
import { LanguageToggle } from "./LanguageToggle"
import arkSfx from "../sfx/ark.wav"
import bf4Sfx from "../sfx/bf4.wav"
import cjSfx from "../sfx/cj.wav"
import cp2077Sfx from "../sfx/cp2077.wav"
import dfSfx from "../sfx/df.wav"
import gsSfx from "../sfx/gs.wav"
import gta5Sfx from "../sfx/gta5.wav"
import mcSfx from "../sfx/mc.wav"
import rdrSfx from "../sfx/rdr.wav"
import svSfx from "../sfx/sv.wav"

// 彩蛋音效：游戏中文标题 → 对应 wav 资源
const sfxByTitle: Record<string, string> = {
  "明日方舟": arkSfx,
  "战地4": bf4Sfx,
  "三角洲行动": dfSfx,
  "原神": gsSfx,
  "侠盗猎车手V": gta5Sfx,
  "我的世界": mcSfx,
  "星露谷物语": svSfx,
  "荒野行动（吃鸡手游大类）": cjSfx,
  "赛博朋克2077": cp2077Sfx,
  "荒野大镖客：救赎2": rdrSfx,
}

type YearRange = "5" | "10" | "15" | "all"

const yearRangeOptions: YearRange[] = ["5", "10", "15", "all"]
const allYears = Object.keys(gameData).sort((a, b) => Number(a) - Number(b))

export const App = () => {
  const { t, language } = useI18n()
  const [selectedGames, setSelectedGames] = usePersistState<string[]>(
    "selectedGames",
    []
  )
  const [yearRange, setYearRange] = usePersistState<YearRange>(
    "yearRange",
    "all"
  )

  // 彩蛋音效播放：点击新音频按钮会打断上一个，可反复触发
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playSfx = (url: string) => {
    const audio = audioRef.current ?? new Audio()
    audioRef.current = audio
    audio.pause()
    audio.currentTime = 0
    audio.src = url
    audio.play().catch(() => {})
  }

  const visibleYears = useMemo(() => {
    if (yearRange === "all") {
      return allYears
    }

    return allYears.slice(-Number(yearRange))
  }, [yearRange])

  const visibleGameKeys = useMemo(() => {
    return visibleYears.flatMap((year) => {
      const items = gameData[year] || []
      return items.slice(0, 12).map((item) => getGameTitle(item, "zh"))
    })
  }, [visibleYears])

  const visibleGameKeySet = useMemo(() => {
    return new Set(visibleGameKeys)
  }, [visibleGameKeys])

  const selectedVisibleGameCount = selectedGames.filter((title) => {
    return visibleGameKeySet.has(title)
  }).length

  const getYearRangeLabel = (option: YearRange) => {
    switch (option) {
      case "5":
        return t("last5Years")
      case "10":
        return t("last10Years")
      case "15":
        return t("last15Years")
      case "all":
        return t("allYears")
    }
  }

  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.title = t("title")
  }, [language, t])

  const imageToBlob = async () => {
    if (!wrapper.current) return

    const el = wrapper.current
    const isMobile = window.innerWidth < 768

    // modern-screenshot 在移动浏览器中需要先把整个 DOM 栅格化到 Canvas。
    // 对长榜单而言，单纯限制 Canvas 的最长边仍可能产生很大的中间内存。
    // 因此手机端同时限制最长边和总像素数；桌面端保持原来的 2x 高清导出。
    const width = Math.max(1, el.scrollWidth, el.offsetWidth)
    const height = Math.max(1, el.scrollHeight, el.offsetHeight)
    const maxDim = Math.max(width, height)

    let scale = 2

    if (isMobile) {
      // 约 4MP 的目标上限通常足够手机查看，同时显著降低 Canvas 内存压力。
      const maxMobilePixels = 4_000_000
      const maxMobileDimension = 3000

      const dimensionScale = maxMobileDimension / maxDim
      const pixelScale = Math.sqrt(maxMobilePixels / (width * height))

      scale = Math.min(1, dimensionScale, pixelScale)

      // 极端长图时避免出现过小的 scale，同时确保最终尺寸至少为 1px。
      scale = Math.max(scale, 0.05)
    }

    // 只预加载实际渲染中的图片（移动端海报图是隐藏的，跳过以免永久等待懒加载）
    const images = Array.from(el.querySelectorAll("img")).filter(
      (img) => img.offsetWidth > 0 && img.offsetHeight > 0
    )

    await Promise.all(
      images.map(async (img) => {
        try {
          // 强制 eager 并重新触发加载，确保桌面端懒加载的屏幕外海报在导出前就绪
          if (img.loading !== "eager") {
            img.loading = "eager"
            img.src = img.src
          }

          if (!img.complete) {
            await new Promise<void>((resolve) => {
              const finish = () => resolve()
              img.addEventListener("load", finish, { once: true })
              img.addEventListener("error", finish, { once: true })
            })
          }

          // decode() 可以避免图片已经 load 但尚未完成位图解码的情况。
          if (img.complete && img.naturalWidth > 0 && img.decode) {
            await img.decode().catch(() => {})
          }
        } catch {
          // 单张海报加载失败不应该阻止整张榜单导出。
        }
      })
    )

    // 等待一次布局/绘制，让刚刚完成的图片解码结果真正进入渲染树。
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve())
      })
    })

    // 字体加载也会影响截图尺寸；若浏览器支持 Font Loading API，则等待字体稳定。
    if (document.fonts?.ready) {
      await document.fonts.ready.catch(() => {})
    }

    const blob = await domToBlob(el, {
      scale,
      // 资源已经提前加载，因此不需要原来的超长等待时间。
      timeout: 30000,
      filter(element) {
        if (
          element instanceof HTMLElement &&
          element.classList.contains("remove")
        ) {
          return false
        }
        return true
      },
    })

    if (!blob || blob.size === 0) {
      throw new Error("截图生成失败：浏览器返回了空图片")
    }

    return blob
  }

  const copyImage = async () => {
    const blob = await imageToBlob()

    if (!blob) return

    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob,
      }),
    ])
  }

  const downloadImage = async () => {
    if (!wrapper.current) return

    const blob = await imageToBlob()

    if (!blob) return

    const url = URL.createObjectURL(blob)

    const a = document.createElement("a")
    a.href = url
    a.download = "game-sedai.png"
    // 移动端 Safari 要求 <a> 已挂载到文档中才能触发下载
    document.body.appendChild(a)
    a.click()
    a.remove()
    // 延迟回收 blob，避免移动端在下载真正开始前就释放导致失败
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  const totalGames = visibleGameKeys.length

  return (
    <>
      <div className="flex flex-col gap-4 pb-10">
        <div className="p-4 flex flex-col md:items-center">
          <div className="flex w-full flex-col gap-2 mb-4 md:flex-row md:items-center md:justify-center">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">{t("yearRange")}:</span>
              <select
                className="border rounded px-2 py-1 text-sm bg-white"
                value={yearRange}
                onChange={(e) => {
                  setYearRange(e.currentTarget.value as YearRange)
                }}
              >
                {yearRangeOptions.map((option) => (
                  <option key={option} value={option}>
                    {getYearRangeLabel(option)}
                  </option>
                ))}
              </select>
            </div>
            <LanguageToggle />
          </div>
          <div className="w-full overflow-x-auto">
            <div
              className="flex flex-col border border-b-0 bg-white w-fit mx-auto"
              ref={wrapper}
            >
              <div className="border-b justify-between p-2 text-lg  font-bold flex">
                <div className="flex flex-col">
                  <h1>
                    {t("title")}
                    <span className="remove"> - {t("subtitle")}</span>
                    <span className="ml-2 text-zinc-400 font-medium">
                      {t("website")}
                    </span>
                  </h1>
                  <span className="remove mt-0.5 text-xs font-normal text-gray-500">
                    {t("soundNotice")}
                  </span>
                  <span className="remove text-xs font-normal text-gray-500">
                    {t("yearNote")}
                  </span>
                </div>
                <span className="shrink-0 whitespace-nowrap">
                  {t("watchedCount", {
                    count: selectedVisibleGameCount,
                    total: totalGames,
                  })}
                </span>
              </div>
              {visibleYears.map((year) => {
                const items = gameData[year] || []
                return (
                  <div key={year} className="flex border-b">
                    <div
                      className={`
                      bg-red-500 shrink-0 text-white flex items-center font-bold justify-center p-1 border-black
                      h-24 md:h-28 w-16 md:w-20
                    `}
                    >
                      <span
                        className={`${
                          language === "en"
                            ? "text-sm md:text-base"
                            : "text-base"
                        } text-center`}
                      >
                        {year}
                      </span>
                    </div>
                    <div className="flex shrink-0">
                      {items.slice(0, 12).map((item) => {
                        const gameKey = getGameTitle(item, "zh")
                        const displayTitle = getGameTitle(item, language)
                        const isSelected = selectedGames.includes(gameKey)
                        const poster = posterByTitle[gameKey]
                        return (
                          <button
                            key={gameKey}
                            className={`
                              h-24 md:h-28 
                              ${
                                language === "en"
                                  ? "w-20 md:w-24"
                                  : "w-16 md:w-20"
                              }
                              border-l break-words text-center shrink-0 inline-flex flex-col items-center justify-center 
                              p-1 overflow-hidden cursor-pointer 
                              ${language === "en" ? "text-xs" : "text-sm"} 
                              ${
                                isSelected
                                  ? "bg-green-500"
                                  : "hover:bg-zinc-100"
                              }
                              transition-colors duration-200
                            `}
                            title={displayTitle}
                            onClick={() => {
                              setSelectedGames((prev) => {
                                if (isSelected) {
                                  return prev.filter(
                                    (title) => title !== gameKey
                                  )
                                }
                                return [...prev, gameKey]
                              })
                              // 仅在“变为选中（变绿）”时播放音效，取消选择不播放
                              if (!isSelected) {
                                const sfxUrl = sfxByTitle[gameKey]
                                if (sfxUrl) {
                                  playSfx(sfxUrl)
                                }
                              }
                            }}
                          >
                            <span
                              className="leading-tight w-full line-clamp-3"
                            >
                              {displayTitle}
                            </span>
                            {poster && (
                              <img
                                src={import.meta.env.BASE_URL + encodeURIComponent(poster)}
                                alt=""
                                draggable={false}
                                // 移动端隐藏海报图（与原始项目一致的纯文字版），保证手机端截图稳定快速；
                                // 保持 lazy 加载，避免隐藏的图片仍被下载浪费手机流量。
                                // 桌面端导出前会在 imageToBlob 中强制 eager 并等待加载完成。
                                loading="lazy"
                                decoding="async"
                                className="hidden md:block h-8 md:h-12 max-w-full object-contain mx-auto mt-1 pointer-events-none shrink-0"
                              />
                            )}
                          </button>
                        )
                      })}
                      {Array.from(
                        { length: Math.max(0, 12 - items.length) },
                        (_, index) => (
                          <div
                            key={`empty-${index}`}
                            className={`
                            h-24 md:h-28 
                            ${
                              language === "en"
                                ? "w-20 md:w-24"
                                : "w-16 md:w-20"
                            }
                            border-l bg-gray-50
                          `}
                          />
                        )
                      )}
                      <div className="w-0 h-24 md:h-28 border-r" />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-center">
          <button
            type="button"
            className="border rounded-md px-4 py-2 inline-flex"
            onClick={() => {
              setSelectedGames((prev) => {
                const hiddenSelectedGames = prev.filter((title) => {
                  return !visibleGameKeySet.has(title)
                })

                return [...hiddenSelectedGames, ...visibleGameKeys]
              })
            }}
          >
            {t("selectAll")}
          </button>

          {selectedVisibleGameCount > 0 && (
            <button
              type="button"
              className="border rounded-md px-4 py-2 inline-flex"
              onClick={() => {
                setSelectedGames((prev) => {
                  return prev.filter((title) => !visibleGameKeySet.has(title))
                })
              }}
            >
              {t("clear")}
            </button>
          )}

          <button
            type="button"
            className="border rounded-md px-4 py-2 inline-flex"
            onClick={() => {
              toast.promise(copyImage(), {
                success: t("copySuccess"),
                loading: t("copying"),
                error(error) {
                  return t("copyFailed", {
                    error:
                      error instanceof Error
                        ? error.message
                        : t("unknownError"),
                  })
                },
              })
            }}
          >
            {t("copyImage")}
          </button>

          <button
            type="button"
            className="border rounded-md px-4 py-2 inline-flex"
            onClick={() => {
              toast.promise(downloadImage(), {
                success: t("downloadSuccess"),
                loading: t("downloading"),
                error(error) {
                  return t("downloadFailed", {
                    error:
                      error instanceof Error
                        ? error.message
                        : t("unknownError"),
                  })
                },
              })
            }}
          >
            {t("downloadImage")}
          </button>
        </div>

        <div className="mt-2 text-center">
          {t("footer")}
          <a
            href="https://github.com/ColdColaRain/Game_Sedai/"
            target="_blank"
            className="underline"
          >
            {t("viewCode")}
          </a>
        </div>

        <div className="text-center">Modified by ColdColaRain</div>
      </div>
    </>
  )
}
